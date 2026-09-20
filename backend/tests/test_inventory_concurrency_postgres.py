"""Concorrência real do estoque informativo em PostgreSQL.

O saldo pode ficar negativo por política de produto, mas nenhum writer pode
perder atualização e baixa/estorno automáticos precisam continuar exactly-once.
"""

from __future__ import annotations

import os
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest

from app.database import SessionLocal, current_restaurante_id
from app.models import (
    Categoria,
    Comanda,
    Insumo,
    Item,
    Lancamento,
    MovimentacaoEstoque,
    Produto,
    ProdutoInsumo,
    Restaurante,
    Usuario,
)
from app.routes.estoque import create_movimentacao
from app.schemas import MovimentacaoEstoqueCreate
from app.services.inventory import (
    SALE_ORIGIN,
    SALE_REVERSAL_ORIGIN,
    consumir_estoque_dos_itens,
    estornar_estoque_dos_itens,
)


pytestmark = pytest.mark.skipif(
    os.getenv("KOMA_PYTEST_USE_EXTERNAL_DATABASE", "false").lower() != "true",
    reason="Exige PostgreSQL efêmero do gate direcionado.",
)


def _seed(*, rid: int, stock: float, item_ids: tuple[str, ...]) -> dict[str, str]:
    user_id = f"inventory-race-user-{rid}"
    category_id = f"inventory-race-category-{rid}"
    product_id = f"inventory-race-product-{rid}"
    insumo_id = f"inventory-race-insumo-{rid}"
    comanda_id = f"inventory-race-command-{rid}"
    launch_id = f"inventory-race-launch-{rid}"

    token = current_restaurante_id.set(rid)
    try:
        with SessionLocal(restaurante_id=rid) as db:
            db.add(Restaurante(id=rid, nome=f"Inventory Race {rid}", plano="bistro"))
            db.flush()
            db.add(
                Usuario(
                    id=user_id,
                    restaurante_id=rid,
                    nome="Operador Estoque",
                    usuario=f"inventory-race-{rid}",
                    email=f"inventory-race-{rid}@koma.test",
                    senha_hash="$2b$12$dummyhashforinventorytests",
                    role="admin",
                    cargo="admin",
                    status="ativo",
                )
            )
            db.add(
                Categoria(
                    id=category_id,
                    restaurante_id=rid,
                    nome="Concorrência de estoque",
                    destino_impressao="NENHUM",
                )
            )
            db.flush()
            db.add(
                Insumo(
                    id=insumo_id,
                    restaurante_id=rid,
                    nome="Ingrediente concorrente",
                    estoque_atual=stock,
                    estoque_minimo=1,
                    estoque_maximo=100,
                    unidade_medida="un",
                    preco_medio_custo=2,
                )
            )
            db.add(
                Produto(
                    id=product_id,
                    restaurante_id=rid,
                    nome="Produto concorrente",
                    categoria_id=category_id,
                    preco=20,
                    ativo=True,
                )
            )
            db.flush()
            db.add(
                ProdutoInsumo(
                    restaurante_id=rid,
                    produto_id=product_id,
                    insumo_id=insumo_id,
                    quantidade=1,
                )
            )
            db.add(
                Comanda(
                    id=comanda_id,
                    restaurante_id=rid,
                    garcom_id=user_id,
                    tipo="Retirada",
                    numero_pedido=rid,
                    delivery_status="producao",
                    fechada=False,
                    valor_pago=0,
                )
            )
            db.flush()
            db.add(
                Lancamento(
                    id=launch_id,
                    restaurante_id=rid,
                    comanda_id=comanda_id,
                    garcom_id=user_id,
                    origem="cardapio",
                    status="producao",
                )
            )
            db.flush()
            db.add_all(
                [
                    Item(
                        id=item_id,
                        restaurante_id=rid,
                        comanda_id=comanda_id,
                        lancamento_id=launch_id,
                        produto_id=product_id,
                        preco_unit=20,
                        status="preparando",
                        pago=False,
                    )
                    for item_id in item_ids
                ]
            )
            db.commit()
    finally:
        current_restaurante_id.reset(token)

    return {
        "user_id": user_id,
        "insumo_id": insumo_id,
    }


def _consume(rid: int, item_id: str, barrier: threading.Barrier) -> None:
    token = current_restaurante_id.set(rid)
    db = SessionLocal(restaurante_id=rid)
    try:
        item = db.query(Item).filter(
            Item.restaurante_id == rid,
            Item.id == item_id,
        ).one()
        barrier.wait(timeout=10)
        consumir_estoque_dos_itens(db, [item], liberar_pendente=True)
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
        current_restaurante_id.reset(token)


def _stock_and_count(rid: int, insumo_id: str, origin: str) -> tuple[float, int]:
    token = current_restaurante_id.set(rid)
    try:
        with SessionLocal(restaurante_id=rid) as db:
            stock = db.query(Insumo).filter(
                Insumo.restaurante_id == rid,
                Insumo.id == insumo_id,
            ).one()
            count = db.query(MovimentacaoEstoque).filter(
                MovimentacaoEstoque.restaurante_id == rid,
                MovimentacaoEstoque.insumo_id == insumo_id,
                MovimentacaoEstoque.origem == origin,
            ).count()
            return float(stock.estoque_atual), count
    finally:
        current_restaurante_id.reset(token)


def test_two_distinct_sales_serialize_and_may_go_negative() -> None:
    rid = 9791
    item_ids = ("inventory-race-sale-a", "inventory-race-sale-b")
    seeded = _seed(rid=rid, stock=1, item_ids=item_ids)
    barrier = threading.Barrier(2)

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(_consume, rid, item_id, barrier) for item_id in item_ids]
        for future in futures:
            future.result(timeout=20)

    stock, count = _stock_and_count(rid, seeded["insumo_id"], SALE_ORIGIN)
    assert stock == -1.0
    assert count == 2


def test_same_sale_retry_is_exactly_once_under_row_lock() -> None:
    rid = 9792
    item_id = "inventory-race-same-sale"
    seeded = _seed(rid=rid, stock=1, item_ids=(item_id,))
    barrier = threading.Barrier(2)

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(_consume, rid, item_id, barrier) for _ in range(2)]
        for future in futures:
            future.result(timeout=20)

    stock, count = _stock_and_count(rid, seeded["insumo_id"], SALE_ORIGIN)
    assert stock == 0.0
    assert count == 1


def test_concurrent_sale_reversal_is_exactly_once() -> None:
    rid = 9793
    item_id = "inventory-race-reversal"
    seeded = _seed(rid=rid, stock=1, item_ids=(item_id,))

    token = current_restaurante_id.set(rid)
    try:
        with SessionLocal(restaurante_id=rid) as db:
            item = db.query(Item).filter(Item.id == item_id).one()
            consumir_estoque_dos_itens(db, [item], liberar_pendente=True)
            db.commit()
    finally:
        current_restaurante_id.reset(token)

    barrier = threading.Barrier(2)

    def reverse() -> None:
        token_inner = current_restaurante_id.set(rid)
        db = SessionLocal(restaurante_id=rid)
        try:
            item = db.query(Item).filter(Item.id == item_id).one()
            barrier.wait(timeout=10)
            estornar_estoque_dos_itens(db, [item])
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()
            current_restaurante_id.reset(token_inner)

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(reverse) for _ in range(2)]
        for future in futures:
            future.result(timeout=20)

    stock, count = _stock_and_count(rid, seeded["insumo_id"], SALE_REVERSAL_ORIGIN)
    assert stock == 1.0
    assert count == 1


def test_manual_positive_adjustment_and_sale_do_not_lose_update() -> None:
    rid = 9794
    item_id = "inventory-race-admin-writer"
    seeded = _seed(rid=rid, stock=1, item_ids=(item_id,))
    barrier = threading.Barrier(2)

    def sell() -> None:
        _consume(rid, item_id, barrier)

    def adjust() -> None:
        token = current_restaurante_id.set(rid)
        db = SessionLocal(restaurante_id=rid)
        try:
            user = db.query(Usuario).filter(
                Usuario.restaurante_id == rid,
                Usuario.id == seeded["user_id"],
            ).one()
            barrier.wait(timeout=10)
            create_movimentacao(
                MovimentacaoEstoqueCreate(
                    insumo_id=seeded["insumo_id"],
                    tipo="ajuste_positivo",
                    quantidade=10,
                    motivo="Reposição concorrente",
                    observacao="Teste PostgreSQL",
                ),
                db=db,
                current_user=user,
            )
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()
            current_restaurante_id.reset(token)

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(sell), executor.submit(adjust)]
        for future in futures:
            future.result(timeout=20)

    stock, sale_count = _stock_and_count(rid, seeded["insumo_id"], SALE_ORIGIN)
    assert stock == 10.0
    assert sale_count == 1
