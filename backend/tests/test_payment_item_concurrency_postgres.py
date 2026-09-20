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
from sqlalchemy import event

from app.database import SessionLocal, current_restaurante_id, engine
from app.financial_models import PagamentoAlocacao
from app.models import (
    CaixaTurno,
    Categoria,
    Comanda,
    Item,
    Lancamento,
    Mesa,
    Pagamento,
    Produto,
    Restaurante,
    Usuario,
)
from app.routes.caixa import registrar_pagamento_comanda, registrar_pagamento_mesa
from app.schemas import PagamentoMesaRequest, PagamentoRequest


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
            db.flush()

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
            db.flush()

            db.add(
                CaixaTurno(
                    restaurante_id=RID,
                    aberto_por_id=USER_ID,
                    saldo_inicial=0,
                    status="aberto",
                )
            )
            db.flush()

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
            db.add(comanda)
            db.flush()
            db.add(lancamento)
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



def _seed_scenario(
    *,
    rid: int,
    user_id: str,
    commands: list[tuple[str, int | None, list[tuple[str, float]]]],
) -> None:
    token = current_restaurante_id.set(rid)
    try:
        with SessionLocal(restaurante_id=rid) as db:
            category_id = f"cat-payment-items-concurrency-{rid}"
            product_id = f"prod-payment-items-concurrency-{rid}"

            db.add(Restaurante(id=rid, nome=f"Payment Items Concurrency {rid}", plano="bistro"))
            db.flush()
            db.add(
                Usuario(
                    id=user_id,
                    restaurante_id=rid,
                    nome=f"Operador Concorrência {rid}",
                    usuario=f"payment-items-concurrency-{rid}",
                    email=f"payment-items-concurrency-{rid}@koma.test",
                    senha_hash="$2b$12$dummyhashforconcurrencytests",
                    role="caixa",
                    cargo="caixa",
                    status="ativo",
                )
            )
            db.add(
                Categoria(
                    id=category_id,
                    restaurante_id=rid,
                    nome=f"Concorrência {rid}",
                )
            )
            for mesa_id in sorted(
                {mesa_id for _, mesa_id, _ in commands if mesa_id is not None}
            ):
                db.add(
                    Mesa(
                        id=mesa_id,
                        restaurante_id=rid,
                        capacidade=4,
                    )
                )
            db.flush()

            db.add(
                Produto(
                    id=product_id,
                    restaurante_id=rid,
                    categoria_id=category_id,
                    nome="Item concorrente",
                    preco=42.0,
                    ativo=True,
                )
            )
            db.flush()
            db.add(
                CaixaTurno(
                    restaurante_id=rid,
                    aberto_por_id=user_id,
                    saldo_inicial=0,
                    status="aberto",
                )
            )
            db.flush()

            for index, (command_id, mesa_id, items) in enumerate(commands, start=1):
                command = Comanda(
                    id=command_id,
                    restaurante_id=rid,
                    mesa_id=mesa_id,
                    garcom_id=user_id,
                    tipo="Consumo no Local" if mesa_id is not None else "Retirada",
                    numero_pedido=rid * 10 + index,
                    delivery_status="pronto",
                    status_comanda="aguardando_pagamento",
                    valor_pago=0,
                    fechada=False,
                )
                launch = Lancamento(
                    id=f"launch-{rid}-{index}",
                    restaurante_id=rid,
                    comanda_id=command_id,
                    garcom_id=user_id,
                    origem="caixa",
                    status="pronto",
                )
                db.add(command)
                db.flush()
                db.add(launch)
                db.flush()
                db.add_all(
                    [
                        Item(
                            id=item_id,
                            restaurante_id=rid,
                            comanda_id=command_id,
                            lancamento_id=launch.id,
                            produto_id=product_id,
                            preco_unit=value,
                            status="pronto",
                            pago=False,
                        )
                        for item_id, value in items
                    ]
                )
            db.commit()
    finally:
        current_restaurante_id.reset(token)


def _first_idempotency_read_barrier(barrier: threading.Barrier):
    seen_count = 0
    seen_lock = threading.Lock()

    def listener(conn, cursor, statement, parameters, context, executemany):
        nonlocal seen_count
        normalized = " ".join(str(statement).lower().split())
        if " from pagamentos " not in f" {normalized} " or "idempotency_key" not in normalized:
            return

        with seen_lock:
            if seen_count >= 2:
                return
            seen_count += 1

        barrier.wait(timeout=10)

    return listener


def test_two_independent_table_transactions_never_reinterpret_stale_item_selection() -> None:
    rid = 9778
    user_id = "payment-items-table-concurrency-user"
    mesa_id = 88
    command_a = "payment-items-table-command-a"
    command_b = "payment-items-table-command-b"
    item_a = "payment-table-concurrent-a"
    item_b = "payment-table-concurrent-b"
    item_c = "payment-table-concurrent-c"

    _seed_scenario(
        rid=rid,
        user_id=user_id,
        commands=[
            (command_a, mesa_id, [(item_a, 42.0)]),
            (command_b, mesa_id, [(item_b, 42.0), (item_c, 42.0)]),
        ],
    )
    barrier = threading.Barrier(2)

    def pay(*, item_ids: list[str], value: float, key: str):
        token = current_restaurante_id.set(rid)
        db = SessionLocal(restaurante_id=rid)
        try:
            user = db.query(Usuario).filter(Usuario.id == user_id).one()
            payload = PagamentoMesaRequest(
                valor=value,
                metodo="pix",
                incluir_taxa_servico=False,
                item_ids=item_ids,
                idempotency_key=key,
            )
            barrier.wait(timeout=10)
            try:
                payment = registrar_pagamento_mesa(
                    mesa_id,
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
            item_ids=[item_a],
            value=42.0,
            key="payment-table-concurrent-one",
        )
        two = executor.submit(
            pay,
            item_ids=[item_a, item_b],
            value=84.0,
            key="payment-table-concurrent-two",
        )
        results = [one.result(timeout=20), two.result(timeout=20)]

    statuses = sorted(result["status"] for result in results)
    assert statuses == [201, 409], results
    conflict = next(result for result in results if result["status"] == 409)
    assert str(conflict["detail"]).startswith("A conta mudou enquanto você recebia.")

    token = current_restaurante_id.set(rid)
    try:
        with SessionLocal(restaurante_id=rid) as db:
            payments = db.query(Pagamento).filter(Pagamento.restaurante_id == rid).all()
            assert len(payments) == 1
            payment = payments[0]
            selected = set(payment.item_ids or [])
            assert selected in ({item_a}, {item_a, item_b})

            items = {
                item.id: item
                for item in db.query(Item).filter(Item.restaurante_id == rid).all()
            }
            assert items[item_c].pago is False
            assert items[item_a].pago is (item_a in selected)
            assert items[item_b].pago is (item_b in selected)

            commands = db.query(Comanda).filter(Comanda.restaurante_id == rid).all()
            assert sum(float(command.valor_pago or 0) for command in commands) == float(payment.valor)

            allocations = db.query(PagamentoAlocacao).filter(
                PagamentoAlocacao.restaurante_id == rid,
                PagamentoAlocacao.pagamento_id == payment.id,
            ).all()
            owner_by_item = {item_a: command_a, item_b: command_b}
            expected_commands = {owner_by_item[item_id] for item_id in selected}
            assert {allocation.comanda_id for allocation in allocations} == expected_commands
            assert sum(float(allocation.valor) for allocation in allocations) == float(payment.valor)
    finally:
        current_restaurante_id.reset(token)


def test_simultaneous_identical_command_retry_returns_same_payment() -> None:
    rid = 9779
    user_id = "payment-items-idempotency-user"
    command_id = "payment-items-idempotency-command"
    item_a = "payment-idempotency-a"
    item_b = "payment-idempotency-b"
    key = "payment-identical-retry-key"

    _seed_scenario(
        rid=rid,
        user_id=user_id,
        commands=[(command_id, None, [(item_a, 42.0), (item_b, 42.0)])],
    )
    start_barrier = threading.Barrier(2)
    first_read_barrier = threading.Barrier(2)
    listener = _first_idempotency_read_barrier(first_read_barrier)
    event.listen(engine, "before_cursor_execute", listener)

    def pay():
        token = current_restaurante_id.set(rid)
        db = SessionLocal(restaurante_id=rid)
        try:
            user = db.query(Usuario).filter(Usuario.id == user_id).one()
            payload = PagamentoRequest(
                valor=42.0,
                metodo="pix",
                item_ids=[item_a],
                idempotency_key=key,
            )
            start_barrier.wait(timeout=10)
            try:
                payment = registrar_pagamento_comanda(
                    command_id,
                    payload,
                    BackgroundTasks(),
                    db=db,
                    current_user=user,
                )
                return {"status": 201, "payment_id": payment.id}
            except HTTPException as exc:
                db.rollback()
                return {"status": exc.status_code, "detail": str(exc.detail)}
        finally:
            db.close()
            current_restaurante_id.reset(token)

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = [future.result(timeout=20) for future in (executor.submit(pay), executor.submit(pay))]
    finally:
        event.remove(engine, "before_cursor_execute", listener)

    assert [result["status"] for result in results] == [201, 201], results
    assert len({result["payment_id"] for result in results}) == 1

    token = current_restaurante_id.set(rid)
    try:
        with SessionLocal(restaurante_id=rid) as db:
            payments = db.query(Pagamento).filter(Pagamento.restaurante_id == rid).all()
            command = db.query(Comanda).filter(Comanda.id == command_id).one()
            items = {
                item.id: item
                for item in db.query(Item).filter(Item.restaurante_id == rid).all()
            }
            assert len(payments) == 1
            assert payments[0].item_ids == [item_a]
            assert float(command.valor_pago) == 42.0
            assert items[item_a].pago is True
            assert items[item_b].pago is False
    finally:
        current_restaurante_id.reset(token)


def test_simultaneous_identical_table_retry_returns_same_payment() -> None:
    rid = 9780
    user_id = "payment-items-table-idempotency-user"
    mesa_id = 89
    command_id = "payment-items-table-idempotency-command"
    item_a = "payment-table-idempotency-a"
    item_b = "payment-table-idempotency-b"
    key = "payment-table-identical-retry-key"

    _seed_scenario(
        rid=rid,
        user_id=user_id,
        commands=[(command_id, mesa_id, [(item_a, 42.0), (item_b, 42.0)])],
    )
    start_barrier = threading.Barrier(2)
    first_read_barrier = threading.Barrier(2)
    listener = _first_idempotency_read_barrier(first_read_barrier)
    event.listen(engine, "before_cursor_execute", listener)

    def pay():
        token = current_restaurante_id.set(rid)
        db = SessionLocal(restaurante_id=rid)
        try:
            user = db.query(Usuario).filter(Usuario.id == user_id).one()
            payload = PagamentoMesaRequest(
                valor=42.0,
                metodo="pix",
                incluir_taxa_servico=False,
                item_ids=[item_a],
                idempotency_key=key,
            )
            start_barrier.wait(timeout=10)
            try:
                payment = registrar_pagamento_mesa(
                    mesa_id,
                    payload,
                    BackgroundTasks(),
                    db=db,
                    current_user=user,
                )
                return {"status": 201, "payment_id": payment.id}
            except HTTPException as exc:
                db.rollback()
                return {"status": exc.status_code, "detail": str(exc.detail)}
        finally:
            db.close()
            current_restaurante_id.reset(token)

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = [future.result(timeout=20) for future in (executor.submit(pay), executor.submit(pay))]
    finally:
        event.remove(engine, "before_cursor_execute", listener)

    assert [result["status"] for result in results] == [201, 201], results
    assert len({result["payment_id"] for result in results}) == 1

    token = current_restaurante_id.set(rid)
    try:
        with SessionLocal(restaurante_id=rid) as db:
            payments = db.query(Pagamento).filter(Pagamento.restaurante_id == rid).all()
            command = db.query(Comanda).filter(Comanda.id == command_id).one()
            items = {
                item.id: item
                for item in db.query(Item).filter(Item.restaurante_id == rid).all()
            }
            assert len(payments) == 1
            assert payments[0].item_ids == [item_a]
            assert float(command.valor_pago) == 42.0
            assert items[item_a].pago is True
            assert items[item_b].pago is False
    finally:
        current_restaurante_id.reset(token)
