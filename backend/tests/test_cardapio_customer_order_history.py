import datetime

import pytest
from fastapi.testclient import TestClient

from app.database import Base, SessionLocal, engine, tenant_session_scope
from app.main import app
from app.models import (
    Categoria,
    Cliente,
    Comanda,
    GrupoModificador,
    Item,
    ItemModificador,
    Lancamento,
    OpcaoModificador,
    Produto,
    Restaurante,
    Usuario,
)
from app.services.customer_auth import create_customer_access_token


client = TestClient(app)


def _cleanup_tenant(db, restaurant_id: int) -> None:
    for model in (ItemModificador, Item, Lancamento, Comanda, Cliente, Produto, Categoria, Usuario):
        db.query(model).filter(model.restaurante_id == restaurant_id).delete(
            synchronize_session=False
        )
    db.query(OpcaoModificador).filter(
        OpcaoModificador.restaurante_id == restaurant_id
    ).delete(synchronize_session=False)
    db.query(GrupoModificador).filter(
        GrupoModificador.restaurante_id == restaurant_id
    ).delete(synchronize_session=False)
    db.commit()


def _seed_identity(db, restaurant_id: int) -> None:
    user = Usuario(
        id=f"history-user-{restaurant_id}",
        restaurante_id=restaurant_id,
        nome="Operador Histórico",
        email=f"history-{restaurant_id}@koma.test",
        cargo="admin",
        status="ativo",
    )
    category = Categoria(
        id=f"history-cat-{restaurant_id}",
        restaurante_id=restaurant_id,
        nome="Histórico",
    )
    product = Produto(
        id=f"history-product-{restaurant_id}",
        restaurante_id=restaurant_id,
        categoria_id=category.id,
        nome=f"Produto {restaurant_id}",
        preco=20.0,
        ativo=True,
    )
    customer = Cliente(
        id=f"history-customer-{restaurant_id}",
        restaurante_id=restaurant_id,
        nome=f"Cliente {restaurant_id}",
        telefone=f"1199999{restaurant_id}",
        saldo_pontos=0,
        saldo_cashback=0,
    )
    db.add_all([user, category, product, customer])
    db.commit()


@pytest.fixture(autouse=True)
def setup_history_data():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        # Restaurante is the tenant root and therefore can be resolved before binding
        # the session. Every tenant-owned write below happens inside its own scope.
        for restaurant_id, slug in [(701, "history-a"), (702, "history-b")]:
            if not db.query(Restaurante).filter(Restaurante.id == restaurant_id).first():
                db.add(
                    Restaurante(
                        id=restaurant_id,
                        nome=f"Restaurante Histórico {restaurant_id}",
                        plano="pro",
                        slug=slug,
                    )
                )
        db.commit()

        for restaurant_id in (701, 702):
            with tenant_session_scope(db, restaurant_id):
                _cleanup_tenant(db, restaurant_id)
                _seed_identity(db, restaurant_id)

        base_time = datetime.datetime(2026, 9, 9, 15, 0, 0)
        with tenant_session_scope(db, 701):
            group = GrupoModificador(
                id="history-group-701",
                restaurante_id=701,
                nome="Molho",
                min_selecoes=0,
                max_selecoes=2,
                tipo="opcional",
            )
            option = OpcaoModificador(
                id="history-option-701",
                restaurante_id=701,
                grupo_id=group.id,
                nome="Molho especial",
                preco_adicional=3.0,
                ativo=True,
            )
            db.add_all([group, option])
            db.commit()

            for index in range(3):
                order = Comanda(
                    id=f"history-order-{index}",
                    restaurante_id=701,
                    garcom_id="history-user-701",
                    cliente_id="history-customer-701",
                    tipo="Retirada",
                    identificador="Cliente 701",
                    numero_pedido=900 + index,
                    fechada=index == 0,
                    fechado_em=base_time + datetime.timedelta(minutes=31) if index == 0 else None,
                    criado_em=base_time + datetime.timedelta(minutes=index),
                    delivery_status="finalizado" if index == 0 else "producao",
                    delivery_taxa=0,
                    valor_desconto_cupom=0,
                    valor_desconto_cashback=0,
                    idempotency_key=f"history-key-{index}",
                )
                launch = Lancamento(
                    id=f"history-launch-{index}",
                    restaurante_id=701,
                    comanda_id=order.id,
                    garcom_id="history-user-701",
                    origem="cardapio",
                    status="finalizado" if index == 0 else "producao",
                    idempotency_key=f"history-launch-key-{index}",
                    timestamp=order.criado_em,
                )
                db.add_all([order, launch])
                db.flush()

                # Two equal rows represent quantity=2 in the operational model.
                for unit in range(2):
                    item = Item(
                        id=f"history-item-{index}-{unit}",
                        restaurante_id=701,
                        comanda_id=order.id,
                        lancamento_id=launch.id,
                        produto_id="history-product-701",
                        preco_unit=23.0 if index == 2 else 20.0,
                        observacao="Sem cebola" if index == 2 else "",
                        status="entregue" if index == 0 else "preparando",
                        pago=False,
                    )
                    db.add(item)
                    db.flush()
                    if index == 2:
                        db.add(
                            ItemModificador(
                                restaurante_id=701,
                                item_id=item.id,
                                opcao_modificador_id="history-option-701",
                                preco_aplicado=3.0,
                            )
                        )
            db.commit()

        with tenant_session_scope(db, 702):
            foreign_order = Comanda(
                id="history-order-foreign",
                restaurante_id=702,
                garcom_id="history-user-702",
                cliente_id="history-customer-702",
                tipo="Retirada",
                identificador="Cliente 702",
                numero_pedido=990,
                fechada=True,
                criado_em=base_time + datetime.timedelta(hours=1),
                delivery_status="finalizado",
                idempotency_key="history-key-foreign",
            )
            foreign_launch = Lancamento(
                id="history-launch-foreign",
                restaurante_id=702,
                comanda_id=foreign_order.id,
                garcom_id="history-user-702",
                origem="cardapio",
                status="finalizado",
                idempotency_key="history-launch-key-foreign",
                timestamp=foreign_order.criado_em,
            )
            db.add_all([foreign_order, foreign_launch])
            db.flush()
            db.add(
                Item(
                    id="history-item-foreign",
                    restaurante_id=702,
                    comanda_id=foreign_order.id,
                    lancamento_id=foreign_launch.id,
                    produto_id="history-product-702",
                    preco_unit=20.0,
                    status="entregue",
                    pago=False,
                )
            )
            db.commit()
    finally:
        db.close()


def customer_token(restaurant_id: int) -> str:
    return create_customer_access_token(
        cliente_id=f"history-customer-{restaurant_id}",
        restaurante_id=restaurant_id,
    )


def test_customer_history_is_authenticated_paginated_and_grouped():
    headers = {"X-Koma-Customer-Token": customer_token(701)}

    first = client.get("/cardapio/clientes/me/pedidos?limit=2", headers=headers)
    assert first.status_code == 200, first.text
    payload = first.json()
    assert [item["numero_pedido"] for item in payload["items"]] == [902, 901]
    assert payload["next_cursor"]

    newest = payload["items"][0]
    assert newest["state"]["label"] == "Em preparo"
    assert newest["itens"] == [
        {
            "produto_id": "history-product-701",
            "nome": "Produto 701",
            "quantidade": 2,
            "preco_unitario": 23.0,
            "observacao": "Sem cebola",
            "modificadores": [
                {
                    "grupo_id": "history-group-701",
                    "grupo_nome": "Molho",
                    "opcao_id": "history-option-701",
                    "opcao_nome": "Molho especial",
                    "preco_aplicado": 3.0,
                }
            ],
        }
    ]
    assert newest["total"] == 46.0
    assert "idempotency_key" not in newest
    assert "tracking_token" not in newest

    second = client.get(
        "/cardapio/clientes/me/pedidos",
        params={"limit": 2, "cursor": payload["next_cursor"]},
        headers=headers,
    )
    assert second.status_code == 200, second.text
    second_payload = second.json()
    assert [item["numero_pedido"] for item in second_payload["items"]] == [900]
    assert second_payload["next_cursor"] is None
    assert second_payload["items"][0]["state"]["label"] == "Concluído"


def test_customer_history_never_crosses_tenant_boundary():
    response = client.get(
        "/cardapio/clientes/me/pedidos?limit=50",
        headers={"X-Koma-Customer-Token": customer_token(701)},
    )
    assert response.status_code == 200
    order_ids = {item["id"] for item in response.json()["items"]}
    assert "history-order-foreign" not in order_ids
    assert order_ids == {"history-order-0", "history-order-1", "history-order-2"}


def test_customer_history_rejects_invalid_token_and_cursor():
    invalid_token = client.get(
        "/cardapio/clientes/me/pedidos",
        headers={"X-Koma-Customer-Token": "not-a-valid-token"},
    )
    assert invalid_token.status_code == 401

    invalid_cursor = client.get(
        "/cardapio/clientes/me/pedidos?cursor=%%%",
        headers={"X-Koma-Customer-Token": customer_token(701)},
    )
    assert invalid_cursor.status_code == 422
