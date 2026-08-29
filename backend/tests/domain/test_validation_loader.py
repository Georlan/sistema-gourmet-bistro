"""Testes de integração do ValidationDataLoader contra banco de testes."""

import pytest
from decimal import Decimal
from app.application.orders.validation_loader import ValidationDataLoader
from app.domain.orders.errors import (
    ProductNotFoundError,
    ProductInactiveError,
    InvalidFulfillmentDetailsError,
)
from app.domain.orders.types import FulfillmentType
from tests.characterization.orders.fixtures import (
    char_client,
    char_setup,
    CHAR_RESTAURANT_ID,
)
from app.database import SessionLocal


def test_validation_loader_loads_and_validates_order_against_db(char_setup):
    """Verifica carregamento relacional e validação completa contra banco real."""
    db = SessionLocal()
    try:
        validated = ValidationDataLoader.validate_order(
            db,
            restaurante_id=CHAR_RESTAURANT_ID,
            fulfillment=FulfillmentType.DELIVERY,
            itens_solicitados=[
                {
                    "produto_id": "prod-char-simples",
                    "quantidade": 1,
                    "modificador_ids": ["mod-char-bacon"],
                }
            ],
            delivery_address="Rua dos Testes, 123",
            delivery_phone="11999990001",
            cupom_codigo="CHAR10",
        )

        assert validated.restaurant_id == CHAR_RESTAURANT_ID
        assert validated.fulfillment == FulfillmentType.DELIVERY
        assert len(validated.items) == 1
        assert validated.items[0].product_id == "prod-char-simples"
        assert len(validated.items[0].modifiers) == 1
        assert validated.items[0].modifiers[0].id == "mod-char-bacon"
        assert validated.coupon is not None
        assert validated.coupon.is_eligible is True
    finally:
        db.close()


def test_validation_loader_rejects_missing_product_against_db(char_setup):
    """Verifica que produto inexistente no banco é rejeitado com ProductNotFoundError."""
    db = SessionLocal()
    try:
        with pytest.raises(ProductNotFoundError):
            ValidationDataLoader.validate_order(
                db,
                restaurante_id=CHAR_RESTAURANT_ID,
                fulfillment=FulfillmentType.PICKUP,
                itens_solicitados=[
                    {
                        "produto_id": "prod-inexistente-12345",
                        "quantidade": 1,
                    }
                ],
            )
    finally:
        db.close()
