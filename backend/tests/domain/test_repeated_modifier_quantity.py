from decimal import Decimal

from app.domain.orders.pricing import OrderPricingService
from app.domain.orders.types import FulfillmentType
from app.domain.orders.validation import (
    OrderValidationInputItem,
    OrderValidationService,
    ValidationContext,
    ValidationModifier,
    ValidationProduct,
)


def test_repeated_modifier_id_counts_each_unit_in_pricing():
    context = ValidationContext(
        restaurant_id=1,
        fulfillment=FulfillmentType.PICKUP,
        items=(
            OrderValidationInputItem(
                product_id="burger",
                quantity=1,
                modifier_ids=("egg", "egg"),
            ),
        ),
        catalog_products={
            "burger": ValidationProduct(
                id="burger",
                restaurant_id=1,
                name="Hamburguer",
                price=Decimal("10.00"),
                is_active=True,
                allowed_modifier_group_ids=("extras",),
            ),
        },
        catalog_modifiers={
            "egg": ValidationModifier(
                id="egg",
                group_id="extras",
                restaurant_id=1,
                name="Ovo",
                price=Decimal("3.00"),
                is_active=True,
            ),
        },
    )

    validated = OrderValidationService.validate(context)

    assert [modifier.id for modifier in validated.items[0].modifiers] == ["egg", "egg"]

    quote = OrderPricingService.calculate_quote(validated.to_pricing_context())
    assert quote.modifiers_total == Decimal("6.00")
    assert quote.subtotal == Decimal("16.00")
    assert quote.total == Decimal("16.00")
