"""Regressões B1-A: isolamento entre pedidos Retirada (com ou sem mesa_id) e contas de Mesa."""

from __future__ import annotations

from decimal import Decimal
import uuid

import pytest

from app.application.orders.commands import (
    CreateOrderCommand,
    CustomerInput,
    DeliveryInput,
    FulfillmentType,
    OrderChannel,
    OrderItemInput,
)
from app.application.orders.service import OrderApplicationService, OrderValidationError
from app.database import SessionLocal
from app.operational_models import AtendimentoMesa
from app.models import Comanda
from tests.characterization.orders.fixtures import char_client, char_setup


def test_pickup_with_optional_mesa_id_is_isolated_from_table_billing_and_closing(char_client, char_setup):
    """[B1-A] Retirada com mesa_id opcional não pode ser cobrada, fechada ou mesclada à conta da mesa."""
    rid = char_setup["restaurant_id"]
    headers = char_setup["headers"]

    # 1. Cria um pedido de Retirada aberto associado à Mesa 1 (sem fechar/pagar)
    with SessionLocal(restaurante_id=rid) as db:
        pickup_dto = OrderApplicationService.create_order(
            db,
            CreateOrderCommand(
                restaurant_id=rid,
                channel=OrderChannel.POS,
                fulfillment=FulfillmentType.PICKUP,
                operator_user_id="usr-char-admin",
                table_id="1",
                customer=CustomerInput(name="Retirada Mesa 1", phone="81999991111"),
                items=(OrderItemInput(product_id="prod-char-simples", quantity=Decimal("1")),),
            ),
        )
        pickup_id = pickup_dto.comanda_id
        pickup_before = db.get(Comanda, pickup_id)
        assert pickup_before is not None and pickup_before.fechada is False

    # 2. Criar comanda de Consumo no Local na Mesa 1 via venda-direta
    sale_res = char_client.post(
        "/comandas/venda-direta",
        json={
            "tipo": "Consumo no Local",
            "mesa_id": 1,
            "itens": [{"produto_id": "prod-char-simples"}],
        },
        headers=headers,
    )
    assert sale_res.status_code == 201, sale_res.text
    table_comanda_id = sale_res.json()["id"]
    assert table_comanda_id != pickup_id

    # Reabrir/buscar via POST /comandas/ com mesa_id=1 + Consumo no Local deve retornar table_comanda_id (nunca pickup_id)
    table_res = char_client.post(
        "/comandas/",
        json={"mesa_id": 1, "garcom_id": "usr-char-admin", "tipo": "Consumo no Local"},
        headers=headers,
    )
    assert table_res.status_code in (200, 201), table_res.text
    assert table_res.json()["id"] == table_comanda_id

    # 3. Pagar a Mesa 1 (valor exato do Consumo no Local) NÃO pode quitar/fechar a Retirada
    with SessionLocal(restaurante_id=rid) as db:
        table_c = db.get(Comanda, table_comanda_id)
        table_total = round(sum(float(it.preco_unit or 0.0) for it in table_c.itens if it.status != "cancelado"), 2)

    pay_res = char_client.post(
        "/caixa/mesas/1/pagar",
        json={
            "valor": table_total,
            "metodo": "dinheiro",
            "idempotency_key": f"b1-mesa-pay-{uuid.uuid4().hex[:8]}",
        },
        headers=headers,
    )
    assert pay_res.status_code in (200, 201), pay_res.text

    with SessionLocal(restaurante_id=rid) as db:
        table_c = db.get(Comanda, table_comanda_id)
        pickup_c = db.get(Comanda, pickup_id)
        try:
            assert table_c is not None
            assert float(table_c.valor_pago or 0.0) == table_total
            assert pickup_c is not None
            assert pickup_c.fechada is False
            assert float(pickup_c.valor_pago or 0.0) == 0.0
        finally:
            if table_c is not None:
                table_c.fechada = True
            if pickup_c is not None:
                pickup_c.fechada = True
            db.query(AtendimentoMesa).filter_by(restaurante_id=rid, mesa_id=1, status="aberto").update(
                {"status": "fechado"}
            )
            db.commit()


def test_delivery_with_mesa_id_is_rejected_in_orders_core_and_service(char_client, char_setup):
    """[B1-A] Delivery não pode ser vinculado a uma mesa nem em /comandas nem no OrderApplicationService."""
    rid = char_setup["restaurant_id"]
    headers = char_setup["headers"]

    res = char_client.post(
        "/comandas/",
        json={"mesa_id": 1, "garcom_id": "usr-char-admin", "tipo": "Delivery"},
        headers=headers,
    )
    assert res.status_code == 422

    with SessionLocal(restaurante_id=rid) as db:
        with pytest.raises(OrderValidationError, match="mesa"):
            OrderApplicationService.create_order(
                db,
                CreateOrderCommand(
                    restaurant_id=rid,
                    channel=OrderChannel.POS,
                    fulfillment=FulfillmentType.DELIVERY,
                    operator_user_id="usr-char-admin",
                    table_id="1",
                    customer=CustomerInput(name="Cliente Delivery", phone="81999990000"),
                    delivery=DeliveryInput(address="Rua Teste, 100", neighborhood="Centro"),
                    items=(OrderItemInput(product_id="prod-char-simples", quantity=Decimal("1")),),
                ),
            )
