"""Testes unitários puros do serviço de validação (OrderValidationService).

Valida regras de integridade de catálogo, isolamento multi-tenant, restrições de adicionais,
requisitos de entrega e separação estrita entre Hard Validation e Eligibility.
"""

from decimal import Decimal
import pytest

from app.domain.orders.errors import (
    EmptyOrderItemsError,
    InvalidFulfillmentDetailsError,
    InvalidItemQuantityError,
    MinimumOrderAmountNotMetError,
    ModifierGroupMismatchError,
    ModifierInactiveError,
    ModifierNotFoundError,
    ProductInactiveError,
    ProductNotFoundError,
    ProductTenantMismatchError,
)
from app.domain.orders.pricing import OrderPricingService
from app.domain.orders.types import FulfillmentType
from app.domain.orders.validation import (
    OrderValidationInputItem,
    OrderValidationService,
    ValidationContext,
    ValidationCoupon,
    ValidationModifier,
    ValidationProduct,
)


def _sample_catalog(restaurant_id: int = 1):
    products = {
        "p1": ValidationProduct(
            id="p1",
            restaurant_id=restaurant_id,
            name="Pizza Margherita",
            price=Decimal("45.00"),
            is_active=True,
            allowed_modifier_group_ids=("g_borda", "g_adicional"),
        ),
        "p2": ValidationProduct(
            id="p2",
            restaurant_id=restaurant_id,
            name="Pizza Inativa",
            price=Decimal("50.00"),
            is_active=False,
        ),
        "p_other_tenant": ValidationProduct(
            id="p_other_tenant",
            restaurant_id=999,  # Outro restaurante
            name="Pizza Outro Restaurante",
            price=Decimal("40.00"),
            is_active=True,
        ),
    }

    modifiers = {
        "m_catupiry": ValidationModifier(
            id="m_catupiry",
            group_id="g_borda",
            restaurant_id=restaurant_id,
            name="Borda Catupiry",
            price=Decimal("8.00"),
            is_active=True,
        ),
        "m_inactive": ValidationModifier(
            id="m_inactive",
            group_id="g_borda",
            restaurant_id=restaurant_id,
            name="Borda Esgotada",
            price=Decimal("8.00"),
            is_active=False,
        ),
        "m_unrelated": ValidationModifier(
            id="m_unrelated",
            group_id="g_sobremesa",  # Não permitido para p1
            restaurant_id=restaurant_id,
            name="Cobertura Chocolate",
            price=Decimal("5.00"),
            is_active=True,
        ),
        "m_other_tenant": ValidationModifier(
            id="m_other_tenant",
            group_id="g_borda",
            restaurant_id=999,
            name="Borda Alheia",
            price=Decimal("5.00"),
            is_active=True,
        ),
    }
    return products, modifiers


class TestOrderValidationService:
    def test_empty_items_raises_error(self):
        prods, mods = _sample_catalog()
        ctx = ValidationContext(
            restaurant_id=1,
            fulfillment=FulfillmentType.PICKUP,
            items=(),
            catalog_products=prods,
            catalog_modifiers=mods,
        )
        with pytest.raises(EmptyOrderItemsError):
            OrderValidationService.validate(ctx)

    def test_zero_or_negative_quantity_raises_error(self):
        prods, mods = _sample_catalog()
        ctx = ValidationContext(
            restaurant_id=1,
            fulfillment=FulfillmentType.PICKUP,
            items=(OrderValidationInputItem(product_id="p1", quantity=0),),
            catalog_products=prods,
            catalog_modifiers=mods,
        )
        with pytest.raises(InvalidItemQuantityError) as exc_info:
            OrderValidationService.validate(ctx)
        assert "p1" in str(exc_info.value)

    def test_product_not_found_raises_error(self):
        prods, mods = _sample_catalog()
        ctx = ValidationContext(
            restaurant_id=1,
            fulfillment=FulfillmentType.PICKUP,
            items=(OrderValidationInputItem(product_id="p_inexistente", quantity=1),),
            catalog_products=prods,
            catalog_modifiers=mods,
        )
        with pytest.raises(ProductNotFoundError):
            OrderValidationService.validate(ctx)

    def test_product_inactive_raises_error(self):
        prods, mods = _sample_catalog()
        ctx = ValidationContext(
            restaurant_id=1,
            fulfillment=FulfillmentType.PICKUP,
            items=(OrderValidationInputItem(product_id="p2", quantity=1),),
            catalog_products=prods,
            catalog_modifiers=mods,
        )
        with pytest.raises(ProductInactiveError):
            OrderValidationService.validate(ctx)

    def test_multi_tenant_isolation_product_rejected(self):
        """Produto de outro restaurante é estritamente rejeitado."""
        prods, mods = _sample_catalog()
        ctx = ValidationContext(
            restaurant_id=1,
            fulfillment=FulfillmentType.PICKUP,
            items=(OrderValidationInputItem(product_id="p_other_tenant", quantity=1),),
            catalog_products=prods,
            catalog_modifiers=mods,
        )
        with pytest.raises(ProductTenantMismatchError) as exc_info:
            OrderValidationService.validate(ctx)
        assert "999" in str(exc_info.value)

    def test_modifier_not_found_raises_error(self):
        prods, mods = _sample_catalog()
        ctx = ValidationContext(
            restaurant_id=1,
            fulfillment=FulfillmentType.PICKUP,
            items=(
                OrderValidationInputItem(
                    product_id="p1",
                    quantity=1,
                    modifier_ids=("m_inexistente",),
                ),
            ),
            catalog_products=prods,
            catalog_modifiers=mods,
        )
        with pytest.raises(ModifierNotFoundError):
            OrderValidationService.validate(ctx)

    def test_modifier_inactive_raises_error(self):
        prods, mods = _sample_catalog()
        ctx = ValidationContext(
            restaurant_id=1,
            fulfillment=FulfillmentType.PICKUP,
            items=(
                OrderValidationInputItem(
                    product_id="p1",
                    quantity=1,
                    modifier_ids=("m_inactive",),
                ),
            ),
            catalog_products=prods,
            catalog_modifiers=mods,
        )
        with pytest.raises(ModifierInactiveError):
            OrderValidationService.validate(ctx)

    def test_multi_tenant_isolation_modifier_rejected(self):
        """Modificador de outro restaurante é estritamente rejeitado."""
        prods, mods = _sample_catalog()
        ctx = ValidationContext(
            restaurant_id=1,
            fulfillment=FulfillmentType.PICKUP,
            items=(
                OrderValidationInputItem(
                    product_id="p1",
                    quantity=1,
                    modifier_ids=("m_other_tenant",),
                ),
            ),
            catalog_products=prods,
            catalog_modifiers=mods,
        )
        with pytest.raises(ProductTenantMismatchError):
            OrderValidationService.validate(ctx)

    def test_modifier_group_mismatch_raises_error(self):
        """Modificador de grupo não permitido para o produto é rejeitado."""
        prods, mods = _sample_catalog()
        ctx = ValidationContext(
            restaurant_id=1,
            fulfillment=FulfillmentType.PICKUP,
            items=(
                OrderValidationInputItem(
                    product_id="p1",
                    quantity=1,
                    modifier_ids=("m_unrelated",),
                ),
            ),
            catalog_products=prods,
            catalog_modifiers=mods,
        )
        with pytest.raises(ModifierGroupMismatchError):
            OrderValidationService.validate(ctx)

    def test_delivery_missing_address_or_phone_raises_error(self):
        prods, mods = _sample_catalog()
        # Sem endereço
        ctx1 = ValidationContext(
            restaurant_id=1,
            fulfillment=FulfillmentType.DELIVERY,
            items=(OrderValidationInputItem(product_id="p1", quantity=1),),
            catalog_products=prods,
            catalog_modifiers=mods,
            delivery_address="",
            delivery_phone="11999998888",
        )
        with pytest.raises(InvalidFulfillmentDetailsError) as exc1:
            OrderValidationService.validate(ctx1)
        assert "Endereço" in str(exc1.value)

        # Sem telefone
        ctx2 = ValidationContext(
            restaurant_id=1,
            fulfillment=FulfillmentType.DELIVERY,
            items=(OrderValidationInputItem(product_id="p1", quantity=1),),
            catalog_products=prods,
            catalog_modifiers=mods,
            delivery_address="Rua Flores, 123",
            delivery_phone="",
        )
        with pytest.raises(InvalidFulfillmentDetailsError) as exc2:
            OrderValidationService.validate(ctx2)
        assert "Telefone" in str(exc2.value)

    def test_delivery_below_minimum_amount_raises_error(self):
        prods, mods = _sample_catalog()
        # p1 custa R$ 45.00, mínimo exigido é R$ 50.00
        ctx = ValidationContext(
            restaurant_id=1,
            fulfillment=FulfillmentType.DELIVERY,
            items=(OrderValidationInputItem(product_id="p1", quantity=1),),
            catalog_products=prods,
            catalog_modifiers=mods,
            delivery_address="Rua Flores, 123",
            delivery_phone="11999998888",
            minimum_delivery_subtotal=Decimal("50.00"),
        )
        with pytest.raises(MinimumOrderAmountNotMetError) as exc:
            OrderValidationService.validate(ctx)
        assert "50.00" in str(exc.value)
        assert "45.00" in str(exc.value)

    def test_pickup_and_dine_in_do_not_enforce_delivery_requirements(self):
        """Retirada e Salão passam com sucesso sem endereço, telefone ou pedido mínimo."""
        prods, mods = _sample_catalog()
        ctx = ValidationContext(
            restaurant_id=1,
            fulfillment=FulfillmentType.PICKUP,
            items=(OrderValidationInputItem(product_id="p1", quantity=1),),
            catalog_products=prods,
            catalog_modifiers=mods,
            delivery_address=None,
            delivery_phone=None,
            minimum_delivery_subtotal=Decimal("100.00"),
        )
        validated = OrderValidationService.validate(ctx)
        assert len(validated.items) == 1
        assert validated.items[0].product_id == "p1"

    def test_coupon_ineligible_does_not_raise_error_and_preserves_order(self):
        """[COMPORTAMENTO LEGADO PRESERVADO] Cupom abaixo do mínimo não quebra a validação do pedido."""
        prods, mods = _sample_catalog()
        coupon = ValidationCoupon(
            code="DESC20",
            discount_type="fixo",
            discount_value=Decimal("20.00"),
            min_order_value=Decimal("100.00"),  # Subtotal é 45.00
        )
        ctx = ValidationContext(
            restaurant_id=1,
            fulfillment=FulfillmentType.PICKUP,
            items=(OrderValidationInputItem(product_id="p1", quantity=1),),
            catalog_products=prods,
            catalog_modifiers=mods,
            coupon=coupon,
        )
        validated = OrderValidationService.validate(ctx)
        assert validated.coupon is not None
        assert validated.coupon.is_eligible is False
        assert "não atingido" in validated.coupon.reason

    def test_validated_order_input_seamlessly_quotes_in_pricing_service(self):
        """Verifica o pipeline completo: ValidatedOrderInput -> OrderPricingService -> OrderQuote exato."""
        prods, mods = _sample_catalog()
        coupon = ValidationCoupon(
            code="PROMO10",
            discount_type="porcentagem",
            discount_value=Decimal("10.00"),
            min_order_value=Decimal("30.00"),
        )
        ctx = ValidationContext(
            restaurant_id=1,
            fulfillment=FulfillmentType.DELIVERY,
            items=(
                OrderValidationInputItem(
                    product_id="p1",
                    quantity=2,
                    modifier_ids=("m_catupiry",),
                ),
            ),
            catalog_products=prods,
            catalog_modifiers=mods,
            delivery_address="Av Central, 500",
            delivery_phone="11999997777",
            coupon=coupon,
        )
        validated = OrderValidationService.validate(ctx)
        assert validated.coupon.is_eligible is True

        # Converter para PricingContext e calcular cotação
        # 2x (45 + 8) = 106.00 | Cupom 10% = 10.60 | Frete = 6.00 | Total = 101.40
        pricing_ctx = validated.to_pricing_context(delivery_fee=Decimal("6.00"))
        quote = OrderPricingService.calculate_quote(pricing_ctx)

        assert quote.subtotal == Decimal("106.00")
        assert quote.modifiers_total == Decimal("16.00")
        assert quote.coupon_discount == Decimal("10.60")
        assert quote.delivery_fee == Decimal("6.00")
        assert quote.total == Decimal("101.40")
