"""Testes unitários puros do serviço de precificação (OrderPricingService).

Valida todas as regras financeiras de cálculo sem banco de dados, sem FastAPI e com
precisão decimal exata (ROUND_HALF_UP).
"""

from decimal import Decimal
import pytest

from app.domain.orders.pricing import (
    CouponPricingInput,
    ItemPricingInput,
    ModifierPricingInput,
    OrderPricingService,
    PricingContext,
)
from app.domain.orders.quote import OrderQuote
from app.domain.orders.types import FulfillmentType


class TestOrderPricingService:
    def test_single_item_base_price(self):
        """1x Item a R$ 25.00 sem modificadores -> subtotal R$ 25.00, total R$ 25.00."""
        item = ItemPricingInput(
            product_id="p1",
            name="Burguer Clássico",
            base_price=Decimal("25.00"),
            quantity=1,
        )
        context = PricingContext(
            fulfillment=FulfillmentType.PICKUP,
            items=(item,),
        )
        quote = OrderPricingService.calculate_quote(context)

        assert quote.subtotal == Decimal("25.00")
        assert quote.modifiers_total == Decimal("0.00")
        assert quote.delivery_fee == Decimal("0.00")
        assert quote.discount_total == Decimal("0.00")
        assert quote.total == Decimal("25.00")
        assert len(quote.items) == 1
        assert quote.items[0].unit_price == Decimal("25.00")
        assert quote.items[0].subtotal == Decimal("25.00")

    def test_multiple_quantity_linear_multiplication(self):
        """3x Item a R$ 25.00 -> subtotal R$ 75.00, total R$ 75.00."""
        item = ItemPricingInput(
            product_id="p1",
            name="Burguer Clássico",
            base_price=Decimal("25.00"),
            quantity=3,
        )
        context = PricingContext(
            fulfillment=FulfillmentType.PICKUP,
            items=(item,),
        )
        quote = OrderPricingService.calculate_quote(context)

        assert quote.subtotal == Decimal("75.00")
        assert quote.total == Decimal("75.00")

    def test_single_item_with_single_modifier(self):
        """1x (Burguer R$ 25.00 + Bacon R$ 5.00) = R$ 30.00."""
        mod = ModifierPricingInput(id="m1", name="Bacon", price=Decimal("5.00"))
        item = ItemPricingInput(
            product_id="p1",
            name="Burguer com Bacon",
            base_price=Decimal("25.00"),
            quantity=1,
            modifiers=(mod,),
        )
        context = PricingContext(
            fulfillment=FulfillmentType.PICKUP,
            items=(item,),
        )
        quote = OrderPricingService.calculate_quote(context)

        assert quote.subtotal == Decimal("30.00")
        assert quote.modifiers_total == Decimal("5.00")
        assert quote.total == Decimal("30.00")
        assert quote.items[0].unit_price == Decimal("30.00")

    def test_single_item_with_multiple_modifiers(self):
        """1x (Burguer R$ 25.00 + Bacon R$ 5.00 + Cheddar R$ 4.00) = R$ 34.00."""
        mod1 = ModifierPricingInput(id="m1", name="Bacon", price=Decimal("5.00"))
        mod2 = ModifierPricingInput(id="m2", name="Cheddar", price=Decimal("4.00"))
        item = ItemPricingInput(
            product_id="p1",
            name="Burguer Duplo Adicional",
            base_price=Decimal("25.00"),
            quantity=1,
            modifiers=(mod1, mod2),
        )
        context = PricingContext(
            fulfillment=FulfillmentType.PICKUP,
            items=(item,),
        )
        quote = OrderPricingService.calculate_quote(context)

        assert quote.subtotal == Decimal("34.00")
        assert quote.modifiers_total == Decimal("9.00")
        assert quote.total == Decimal("34.00")
        assert quote.items[0].unit_price == Decimal("34.00")

    def test_multiple_quantity_with_modifiers(self):
        """2x (Burguer R$ 25.00 + Bacon R$ 5.00 + Cheddar R$ 4.00) = 2 * 34.00 = R$ 68.00."""
        mod1 = ModifierPricingInput(id="m1", name="Bacon", price=Decimal("5.00"))
        mod2 = ModifierPricingInput(id="m2", name="Cheddar", price=Decimal("4.00"))
        item = ItemPricingInput(
            product_id="p1",
            name="Burguer Duplo Adicional",
            base_price=Decimal("25.00"),
            quantity=2,
            modifiers=(mod1, mod2),
        )
        context = PricingContext(
            fulfillment=FulfillmentType.PICKUP,
            items=(item,),
        )
        quote = OrderPricingService.calculate_quote(context)

        assert quote.subtotal == Decimal("68.00")
        assert quote.modifiers_total == Decimal("18.00")  # (5 + 4) * 2
        assert quote.total == Decimal("68.00")
        assert quote.items[0].unit_price == Decimal("34.00")
        assert quote.items[0].subtotal == Decimal("68.00")

    def test_delivery_fee_applied_for_delivery(self):
        """Delivery de R$ 25.00 + taxa R$ 7.00 = R$ 32.00."""
        item = ItemPricingInput(
            product_id="p1",
            name="Burguer",
            base_price=Decimal("25.00"),
            quantity=1,
        )
        context = PricingContext(
            fulfillment=FulfillmentType.DELIVERY,
            items=(item,),
            delivery_fee=Decimal("7.00"),
        )
        quote = OrderPricingService.calculate_quote(context)

        assert quote.subtotal == Decimal("25.00")
        assert quote.delivery_fee == Decimal("7.00")
        assert quote.total == Decimal("32.00")

    def test_delivery_fee_zeroed_for_pickup(self):
        """Retirada sempre zera taxa de entrega mesmo se informada no contexto."""
        item = ItemPricingInput(
            product_id="p1",
            name="Burguer",
            base_price=Decimal("25.00"),
            quantity=1,
        )
        context = PricingContext(
            fulfillment=FulfillmentType.PICKUP,
            items=(item,),
            delivery_fee=Decimal("7.00"),
        )
        quote = OrderPricingService.calculate_quote(context)

        assert quote.delivery_fee == Decimal("0.00")
        assert quote.total == Decimal("25.00")

    def test_percentage_discount_coupon_with_penny_rounding(self):
        """15% de desconto em R$ 25.00 = R$ 3.75 de desconto -> R$ 21.25."""
        item = ItemPricingInput(
            product_id="p1",
            name="Burguer",
            base_price=Decimal("25.00"),
            quantity=1,
        )
        coupon = CouponPricingInput(
            code="DESC15",
            discount_type="porcentagem",
            discount_value=Decimal("15.00"),
            min_order_value=Decimal("0.00"),
        )
        context = PricingContext(
            fulfillment=FulfillmentType.PICKUP,
            items=(item,),
            coupon=coupon,
        )
        quote = OrderPricingService.calculate_quote(context)

        assert quote.subtotal == Decimal("25.00")
        assert quote.coupon_discount == Decimal("3.75")
        assert quote.discount_total == Decimal("3.75")
        assert quote.total == Decimal("21.25")

    def test_fixed_discount_coupon(self):
        """2x Burguer (R$ 50.00) + Cupom FIXO15 (R$ 15.00) = R$ 35.00."""
        item = ItemPricingInput(
            product_id="p1",
            name="Burguer",
            base_price=Decimal("25.00"),
            quantity=2,
        )
        coupon = CouponPricingInput(
            code="FIXO15",
            discount_type="fixo",
            discount_value=Decimal("15.00"),
            min_order_value=Decimal("40.00"),
        )
        context = PricingContext(
            fulfillment=FulfillmentType.PICKUP,
            items=(item,),
            coupon=coupon,
        )
        quote = OrderPricingService.calculate_quote(context)

        assert quote.subtotal == Decimal("50.00")
        assert quote.coupon_discount == Decimal("15.00")
        assert quote.total == Decimal("35.00")

    def test_coupon_below_minimum_ignored_silently(self):
        """1x Burguer (R$ 25.00) com Cupom de mínimo R$ 40.00 -> desconto é 0.00 e total é R$ 25.00."""
        item = ItemPricingInput(
            product_id="p1",
            name="Burguer",
            base_price=Decimal("25.00"),
            quantity=1,
        )
        coupon = CouponPricingInput(
            code="FIXO15",
            discount_type="fixo",
            discount_value=Decimal("15.00"),
            min_order_value=Decimal("40.00"),
        )
        context = PricingContext(
            fulfillment=FulfillmentType.PICKUP,
            items=(item,),
            coupon=coupon,
        )
        quote = OrderPricingService.calculate_quote(context)

        assert quote.coupon_discount == Decimal("0.00")
        assert quote.total == Decimal("25.00")

    def test_coupon_inactive_or_expired_ignored_silently(self):
        """Cupom inativo ou expirado tem desconto 0.00."""
        item = ItemPricingInput(
            product_id="p1",
            name="Burguer",
            base_price=Decimal("50.00"),
            quantity=1,
        )
        coupon_inactive = CouponPricingInput(
            code="INATIVO",
            discount_type="fixo",
            discount_value=Decimal("10.00"),
            is_active=False,
        )
        quote1 = OrderPricingService.calculate_quote(
            PricingContext(fulfillment=FulfillmentType.PICKUP, items=(item,), coupon=coupon_inactive)
        )
        assert quote1.coupon_discount == Decimal("0.00")

        coupon_expired = CouponPricingInput(
            code="EXPIRADO",
            discount_type="fixo",
            discount_value=Decimal("10.00"),
            is_expired=True,
        )
        quote2 = OrderPricingService.calculate_quote(
            PricingContext(fulfillment=FulfillmentType.PICKUP, items=(item,), coupon=coupon_expired)
        )
        assert quote2.coupon_discount == Decimal("0.00")

    def test_cashback_applied_partially(self):
        """Item R$ 25.00 com R$ 6.00 de cashback -> total R$ 19.00."""
        item = ItemPricingInput(
            product_id="p1",
            name="Burguer",
            base_price=Decimal("25.00"),
            quantity=1,
        )
        context = PricingContext(
            fulfillment=FulfillmentType.PICKUP,
            items=(item,),
            available_cashback=Decimal("6.00"),
            apply_cashback=True,
        )
        quote = OrderPricingService.calculate_quote(context)

        assert quote.subtotal == Decimal("25.00")
        assert quote.cashback_discount == Decimal("6.00")
        assert quote.discount_total == Decimal("6.00")
        assert quote.total == Decimal("19.00")

    def test_cashback_capped_at_remaining_subtotal_after_coupon(self):
        """Subtotal R$ 25.00, Cupom R$ 20.00, Cashback disponível R$ 10.00: cashback consome apenas R$ 5.00 e total fica R$ 0.00."""
        item = ItemPricingInput(
            product_id="p1",
            name="Burguer",
            base_price=Decimal("25.00"),
            quantity=1,
        )
        coupon = CouponPricingInput(
            code="CUPOM20",
            discount_type="fixo",
            discount_value=Decimal("20.00"),
        )
        context = PricingContext(
            fulfillment=FulfillmentType.PICKUP,
            items=(item,),
            coupon=coupon,
            available_cashback=Decimal("10.00"),
            apply_cashback=True,
        )
        quote = OrderPricingService.calculate_quote(context)

        assert quote.coupon_discount == Decimal("20.00")
        assert quote.cashback_discount == Decimal("5.00")  # Limitado a 25 - 20 = 5
        assert quote.discount_total == Decimal("25.00")
        assert quote.total == Decimal("0.00")

    def test_service_fee_calculation(self):
        """Subtotal R$ 100.00 com 10% de taxa de serviço no salão -> R$ 110.00."""
        item = ItemPricingInput(
            product_id="p1",
            name="Burguer Salão",
            base_price=Decimal("100.00"),
            quantity=1,
        )
        context = PricingContext(
            fulfillment=FulfillmentType.DINE_IN,
            items=(item,),
            service_tax_rate=Decimal("10.00"),
        )
        quote = OrderPricingService.calculate_quote(context)

        assert quote.subtotal == Decimal("100.00")
        assert quote.service_fee == Decimal("10.00")
        assert quote.total == Decimal("110.00")

    def test_to_float_dict_serialization(self):
        """OrderQuote.to_float_dict() gera dicionário limpo para serialização JSON."""
        item = ItemPricingInput(
            product_id="p1",
            name="Burguer",
            base_price=Decimal("25.00"),
            quantity=2,
            modifiers=(ModifierPricingInput(id="m1", name="Bacon", price=Decimal("5.00")),),
        )
        context = PricingContext(
            fulfillment=FulfillmentType.DELIVERY,
            items=(item,),
            delivery_fee=Decimal("7.00"),
        )
        quote = OrderPricingService.calculate_quote(context)
        data = quote.to_float_dict()

        assert data["subtotal"] == 60.0
        assert data["modifiers_total"] == 10.0
        assert data["delivery_fee"] == 7.0
        assert data["total"] == 67.0
        assert data["items"][0]["unit_price"] == 30.0
