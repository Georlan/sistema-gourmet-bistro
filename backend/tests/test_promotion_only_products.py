from decimal import Decimal

import pytest

from app.domain.orders.errors import OrderValidationError
from app.domain.orders.types import FulfillmentType
from app.domain.orders.validation import ValidatedOrderInput, ValidatedOrderItem
from app.models import Produto
from app.promotions import validate_exclusive_promotion_parts
from app.schemas import ProdutoCreate, ProdutoUpdate


def _order(*ids: str) -> ValidatedOrderInput:
    return ValidatedOrderInput(
        restaurant_id=6, fulfillment=FulfillmentType.PICKUP,
        items=tuple(ValidatedOrderItem(
            product_id=identifier, name=identifier, base_price=Decimal("3.00"),
            quantity=Decimal("1"),
        ) for identifier in ids),
    )


def _campaign() -> dict:
    return {
        "id": "promo-g-pitulinha",
        "nome": "Quentinha G + Pitulinha", "ativo": True,
        "preco": 16, "componentes": [["g"], ["pitulinha"]],
    }


def test_exclusive_component_is_allowed_only_in_actual_promotion_slot():
    validate_exclusive_promotion_parts({"pitulinha"}, _campaign(), _order("g", "pitulinha"))
    # Bebida comum continua disponível normalmente; a exceção é por SKU.
    validate_exclusive_promotion_parts(set(), None, _order("refrigerante"))


def test_exclusive_component_cannot_be_sold_loosely_or_as_extra_to_another_combo():
    with pytest.raises(OrderValidationError):
        validate_exclusive_promotion_parts({"pitulinha"}, None, _order("pitulinha"))
    with pytest.raises(OrderValidationError):
        validate_exclusive_promotion_parts(
            {"pitulinha"}, {**_campaign(), "ativo": False}, _order("g", "pitulinha"),
        )
    with pytest.raises(OrderValidationError):
        validate_exclusive_promotion_parts(
            {"pitulinha"}, {**_campaign(), "componentes": [["g"], ["m"]]},
            _order("g", "m", "pitulinha"),
        )
    with pytest.raises(OrderValidationError):
        validate_exclusive_promotion_parts(
            {"pitulinha", "outro_exclusivo"}, _campaign(), _order("g", "pitulinha", "outro_exclusivo"),
        )


def test_exclusive_sku_is_a_regular_tenant_owned_product_by_default():
    assert Produto.__table__.columns["somente_promocao"].nullable is False
    assert ProdutoCreate(
        id="pitulinha", nome="Pitulinha", categoria_id="bebidas", preco=3,
    ).somente_promocao is False
    assert ProdutoCreate(
        id="pitulinha", nome="Pitulinha", categoria_id="bebidas", preco=3,
        somente_promocao=True,
    ).somente_promocao is True
    assert ProdutoUpdate(somente_promocao=True).somente_promocao is True


def test_marked_combo_allows_loose_meal_but_never_loose_exclusive_drink():
    validate_exclusive_promotion_parts(
        {'pitulinha'}, _campaign(), _order('g', 'pitulinha', 'g'), item_indices=(0, 1),
    )
    with pytest.raises(OrderValidationError):
        validate_exclusive_promotion_parts(
            {'pitulinha'}, _campaign(), _order('g', 'pitulinha', 'pitulinha'), item_indices=(0, 1),
        )
