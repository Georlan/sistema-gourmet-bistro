"""Testes de integração do PricingDataLoader contra banco de testes."""

import pytest
from decimal import Decimal
from app.application.orders.pricing_loader import PricingDataLoader
from app.domain.orders.types import FulfillmentType
from tests.characterization.orders.fixtures import (
    char_client,
    char_setup,
    CHAR_RESTAURANT_ID,
)
from app.database import SessionLocal


def test_pricing_data_loader_builds_quote_matching_database(char_setup):
    """Verifica que o PricingDataLoader resolve produtos, modificadores e cupons do banco real."""
    db = SessionLocal()
    try:
        # 2x Burguer Simples (R$ 25.00 + Bacon R$ 5.00 + Cheddar R$ 4.00 = R$ 34.00 * 2 = R$ 68.00)
        # + Cupom CHAR10 (10% = R$ 6.80) + Delivery Fee R$ 7.00 = R$ 68.20
        quote = PricingDataLoader.calculate_order_quote(
            db,
            restaurante_id=CHAR_RESTAURANT_ID,
            fulfillment=FulfillmentType.DELIVERY,
            itens_solicitados=[
                {
                    "produto_id": "prod-char-simples",
                    "quantidade": 2,
                    "modificador_ids": ["mod-char-bacon", "mod-char-cheddar"],
                }
            ],
            delivery_fee=7.00,
            cupom_codigo="CHAR10",
            cliente_telefone="11999990001",
        )

        assert quote.subtotal == Decimal("68.00")
        assert quote.modifiers_total == Decimal("18.00")
        assert quote.coupon_discount == Decimal("6.80")
        assert quote.delivery_fee == Decimal("7.00")
        assert quote.total == Decimal("68.20")
    finally:
        db.close()
