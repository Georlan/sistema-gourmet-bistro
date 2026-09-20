"""Concorrência real de pagamento por itens em PostgreSQL.

Duas sessões/transações independentes disputam a mesma comanda. O lock pode
escolher qualquer vencedor; o perdedor deve observar o estado já confirmado e
receber 409, sem pagamento parcial, sem reinterpretar a seleção e sem tocar em
item fora do escopo confirmado.
"""

from __future__ import annotations

import os
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import BackgroundTasks, HTTPException

from app.database import SessionLocal, current_restaurante_id
from app.models import (
    CaixaTurno,
    Categoria,
    Comanda,
    Item,
    Lancamento,
    Pagamento,
    Produto,
    Restaurante,
    Usuario,
)
from app.routes.caixa import registrar_pagamento_comanda
from app.schemas import PagamentoRequest


RID = 9777
USER_ID = "payment-items-concurrency-user"
COMANDA_ID = "payment-items-concurrency-command"

pytestmark = pytest.mark.skipif(
    os.getenv("KOMA_PYTEST_USE_EXTERNAL_DATABASE", "false").lower() != "true",
    reason="Exige PostgreSQL efêmero do gate direcionado.",
)


def _tenant_session():
    return SessionLocal(restaurante_id=RID)


def _seed() -> None:
    token = current_restaurante_id.set(RID)
    try:
        with _tenant_session() as db:
            db.add(Restaurante(id=RID, nome="Payment Items Concurrency", plano="bistro"))
            db.add(
                Usuario(
                    id=USER_ID,
                    restaurante_id=RID,
                    nome="Operador Concorrência",
                    usuario="payment-items-concurrency",
                    email="payment-items-concurrency@koma.test",
                    senha_hash="$2b$12$dummyhashforconcurrencytests",
                    role="caixa",
                    cargo="caixa",
                    status="ativo",
                )
            )
            db.add(
                Categoria(
                    id="cat-payment-items-concurrency",
                    restaurante_id=RID,
                    nome="Concorrência",
                )
            )
            db.flush()
            db.add(
                Produto(
                    id="prod-payment-items-concurrency",
                    restaurante_id=RID,
                    categoria_id="cat-payment-items-concurrency",
                    nome="Item concorrente",
                    preco=42.0,
                    ativo=True,
                )
            )
            db.add(
                CaixaTurno(
                    restaurante_id=RID,
                    aberto_por_id=USER_ID,
                    saldo_inicial=0,
                    status="aberto",
                )
            )
            comanda = Comanda(
                id=COMANDA_ID,
                restaurante_id=RID,
                mesa_id=None,
                garcom_id=USER_ID,
                tipo="Retirada",
                numero_pedido=97771,
                delivery_status="pronto",
                status_comanda="aguardando_pagamento",
                valor_pago=0,
                fechada=False,
            )
            lancamento = Lancamento(
                id="launch-payment-items-concurrency",
                restaurante_id=RID,
                comanda_id=COMANDA_ID,
                garcom_id=USER_ID,
                origem="caixa",
                status="pronto",
            )
            db.add_all([comanda, lancamento])
            db.flush()
            db.add_all(
                [
                    Item(
                        id=f"payment-concurrent-{suffix}",
                        restaurante_id=RID,
                        comanda_id=COMANDA_ID,
                        lancamento_id=lancamento.id,
                        produto_id="prod-payment-items-concurrency",
                        preco_unit=42.0,
                        status="pronto",
                        pago=False,
                    )
                    for suffix in ("a", "b", "c")
                ]
            )
            db.commit()
    finally:
        current_restaurante_id.reset(token)


def test_two_independent_transactions_never_reinterpret_stale_item_selection() -> None:
    _seed()
    barrier = threading.Barrier(2)

    def pay(*, item_ids: list[str], value: float, key: str):
        token = current_restaurante_id.set(RID)
        db = _tenant_session()
        try:
            user = db.query(Usuario).filter(Usuario.id == USER_ID).one()
            payload = PagamentoRequest(
                valor=value,
                metodo="pix",
                item_ids=item_ids,
                idempotency_key=key,
            )
            barrier.wait(timeout=10)
            try:
                payment = registrar_pagamento_comanda(
                    COMANDA_ID,
                    payload,
                    BackgroundTasks(),
                    db=db,
                    current_user=user,
                )
                return {
                    "status": 201,
                    "payment_id": payment.id,
                    "item_ids": list(payment.item_ids or []),
                    "value": float(payment.valor),
                }
            except HTTPException as exc:
                db.rollback()
                return {"status": exc.status_code, "detail": str(exc.detail)}
        finally:
            db.close()
            current_restaurante_id.reset(token)

    with ThreadPoolExecutor(max_workers=2) as executor:
        one = executor.submit(
            pay,
            item_ids=["payment-concurrent-a"],
            value=42.0,
            key="payment-concurrent-one",
        )
        two = executor.submit(
            pay,
            item_ids=["payment-concurrent-a", "payment-concurrent-b"],
            value=84.0,
            key="payment-concurrent-two",
        )
        results = [one.result(timeout=20), two.result(timeout=20)]

    statuses = sorted(result["status"] for result in results)
    assert statuses == [201, 409], results
    conflict = next(result for result in results if result["status"] == 409)
    assert str(conflict["detail"]).startswith("A conta mudou enquanto você recebia.")

    token = current_restaurante_id.set(RID)
    try:
        with _tenant_session() as db:
            command = db.query(Comanda).filter(Comanda.id == COMANDA_ID).one()
            payments = db.query(Pagamento).filter(
                Pagamento.restaurante_id == RID,
                Pagamento.comanda_id == COMANDA_ID,
            ).all()
            items = {
                item.id: item
                for item in db.query(Item).filter(
                    Item.restaurante_id == RID,
                    Item.comanda_id == COMANDA_ID,
                ).all()
            }

            assert len(payments) == 1
            payment = payments[0]
            assert payment.item_ids in (
                ["payment-concurrent-a"],
                ["payment-concurrent-a", "payment-concurrent-b"],
            )
            assert float(command.valor_pago) == float(payment.valor)
            assert command.fechada is False
            assert items["payment-concurrent-c"].pago is False

            selected = set(payment.item_ids or [])
            for item_id, item in items.items():
                assert item.pago is (item_id in selected)
    finally:
        current_restaurante_id.reset(token)
