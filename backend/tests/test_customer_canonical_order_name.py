from __future__ import annotations

from decimal import Decimal

from app.application.orders.commands import (
    CreateOrderCommand,
    CustomerInput,
    DeliveryInput,
    OrderItemInput,
)
from app.application.orders.service import OrderApplicationService
from app.database import SessionLocal
from app.domain.orders.types import FulfillmentType, OrderChannel
from app.models import Cliente, Comanda
from tests.characterization.orders.fixtures import CHAR_RESTAURANT_ID, char_setup


def test_public_order_uses_canonical_customer_name_in_operational_check(char_setup):
    db = SessionLocal()
    phone = "11988881991"
    try:
        customer = Cliente(
            id="customer-canonical-order-name",
            restaurante_id=CHAR_RESTAURANT_ID,
            telefone=phone,
            nome="Nome Canônico",
            endereco="Rua Salva, 10",
            saldo_pontos=0,
            saldo_cashback=0,
        )
        db.add(customer)
        db.commit()

        dto = OrderApplicationService.create_order(
            db,
            CreateOrderCommand(
                restaurant_id=CHAR_RESTAURANT_ID,
                channel=OrderChannel.WEB_CARDAPIO,
                fulfillment=FulfillmentType.DELIVERY,
                items=(
                    OrderItemInput(
                        product_id="prod-char-simples",
                        quantity=Decimal("1.00"),
                    ),
                ),
                customer=CustomerInput(
                    name="Nome informado no checkout",
                    phone=phone,
                ),
                delivery=DeliveryInput(address="Rua digitada no pedido, 99"),
            ),
        )
        db.expire_all()

        persisted_customer = db.query(Cliente).filter(
            Cliente.restaurante_id == CHAR_RESTAURANT_ID,
            Cliente.telefone == phone,
        ).one()
        command = db.query(Comanda).filter(
            Comanda.restaurante_id == CHAR_RESTAURANT_ID,
            Comanda.id == dto.comanda_id,
        ).one()

        assert command.cliente_id == persisted_customer.id
        assert command.identificador == "Nome Canônico"
        assert persisted_customer.nome == "Nome Canônico"
        assert persisted_customer.endereco == "Rua Salva, 10"
    finally:
        db.close()
