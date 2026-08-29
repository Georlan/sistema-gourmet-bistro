"""Serviço puro de precificação e cálculo de cotações de pedidos (Kôma).

Regras de negócio 100% puras (sem dependência de FastAPI, SQLAlchemy ou banco de dados).
Utiliza aritmética de Decimal com precisão monetária e arredondamento padrão bancário (ROUND_HALF_UP).
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from typing import Sequence

from .quote import ItemQuote, ModifierQuote, OrderQuote
from .types import FulfillmentType

CENT = Decimal("0.01")


def to_money_decimal(value: Decimal | int | float | str | None) -> Decimal:
    """Converte e quantiza seguramente qualquer valor para Decimal com 2 casas."""
    if value is None:
        return Decimal("0.00")
    if isinstance(value, Decimal):
        return value.quantize(CENT, rounding=ROUND_HALF_UP)
    return Decimal(str(value)).quantize(CENT, rounding=ROUND_HALF_UP)


def to_quantity_decimal(value: Decimal | int | float | str | None) -> Decimal:
    """Converte e quantiza quantidade para Decimal com 2 casas."""
    if value is None:
        return Decimal("0.00")
    if isinstance(value, Decimal):
        return value.quantize(CENT, rounding=ROUND_HALF_UP)
    return Decimal(str(value)).quantize(CENT, rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class ModifierPricingInput:
    """Dados de entrada de um modificador para precificação."""

    id: str | int
    name: str
    price: Decimal


@dataclass(frozen=True)
class ItemPricingInput:
    """Dados de entrada de um item do carrinho para precificação."""

    product_id: str | int
    name: str
    base_price: Decimal
    quantity: Decimal | int
    modifiers: tuple[ModifierPricingInput, ...] = ()
    notes: str | None = None


@dataclass(frozen=True)
class CouponPricingInput:
    """Dados de entrada de um cupom de desconto para precificação."""

    code: str
    discount_type: str  # "porcentagem" | "fixo"
    discount_value: Decimal
    min_order_value: Decimal = Decimal("0.00")
    is_active: bool = True
    is_expired: bool = False
    is_usage_limit_reached: bool = False
    is_first_purchase_only: bool = False
    customer_has_previous_orders: bool = False


@dataclass(frozen=True)
class PricingContext:
    """Contexto financeiro completo para cotação pura de um pedido."""

    fulfillment: FulfillmentType
    items: tuple[ItemPricingInput, ...]
    delivery_fee: Decimal = Decimal("0.00")
    coupon: CouponPricingInput | None = None
    available_cashback: Decimal = Decimal("0.00")
    apply_cashback: bool = False
    service_tax_rate: Decimal = Decimal("0.00")


class OrderPricingService:
    """Motor puro de precificação de pedidos do Kôma."""

    @staticmethod
    def calculate_quote(context: PricingContext) -> OrderQuote:
        """Calcula a cotação consolidada preservando todas as regras financeiras do legado."""
        item_quotes: list[ItemQuote] = []
        items_subtotal = Decimal("0.00")
        modifiers_total = Decimal("0.00")

        # 1. Itens e Modificadores
        for item_in in context.items:
            base_price = to_money_decimal(item_in.base_price)
            quantity = to_quantity_decimal(item_in.quantity)

            # Modificadores do item
            modifier_quotes: list[ModifierQuote] = []
            item_modifiers_sum = Decimal("0.00")
            for mod in item_in.modifiers:
                mod_price = to_money_decimal(mod.price)
                item_modifiers_sum += mod_price
                modifier_quotes.append(
                    ModifierQuote(
                        id=mod.id,
                        name=mod.name,
                        unit_price=mod_price,
                    )
                )

            # Preço unitário do item (produto + adicionais)
            unit_price = to_money_decimal(base_price + item_modifiers_sum)
            item_subtotal = to_money_decimal(unit_price * quantity)

            items_subtotal += item_subtotal
            modifiers_total += to_money_decimal(item_modifiers_sum * quantity)

            item_quotes.append(
                ItemQuote(
                    product_id=item_in.product_id,
                    name=item_in.name,
                    quantity=quantity,
                    unit_price=unit_price,
                    modifiers=tuple(modifier_quotes),
                    subtotal=item_subtotal,
                    notes=item_in.notes,
                )
            )

        items_subtotal = to_money_decimal(items_subtotal)
        modifiers_total = to_money_decimal(modifiers_total)

        # 2. Taxa de Entrega (Retirada e Salão não cobram frete)
        if context.fulfillment in {FulfillmentType.PICKUP, FulfillmentType.DINE_IN}:
            delivery_fee = Decimal("0.00")
        else:
            delivery_fee = to_money_decimal(context.delivery_fee)

        # 3. Taxa de Serviço (Geralmente no salão)
        if context.service_tax_rate > Decimal("0.00"):
            service_fee = to_money_decimal((items_subtotal * context.service_tax_rate) / Decimal("100.00"))
        else:
            service_fee = Decimal("0.00")

        # 4. Cálculo de Cupom
        coupon_discount = Decimal("0.00")
        if context.coupon is not None:
            coupon = context.coupon
            is_eligible = (
                coupon.is_active
                and not coupon.is_expired
                and not coupon.is_usage_limit_reached
                and items_subtotal >= to_money_decimal(coupon.min_order_value)
                and not (coupon.is_first_purchase_only and coupon.customer_has_previous_orders)
            )
            if is_eligible:
                disc_val = to_money_decimal(coupon.discount_value)
                if coupon.discount_type.lower() == "porcentagem":
                    calc_disc = to_money_decimal((items_subtotal * disc_val) / Decimal("100.00"))
                    coupon_discount = min(calc_disc, items_subtotal)
                else:  # Fixo
                    coupon_discount = min(disc_val, items_subtotal)

        # 5. Cálculo de Cashback
        cashback_discount = Decimal("0.00")
        if context.apply_cashback and context.available_cashback > Decimal("0.00"):
            available_cb = to_money_decimal(context.available_cashback)
            max_cb_allowed = max(Decimal("0.00"), items_subtotal - coupon_discount)
            cashback_discount = min(available_cb, max_cb_allowed)

        # 6. Total Geral Consolidado
        discount_total = to_money_decimal(coupon_discount + cashback_discount)
        total_calculated = items_subtotal + delivery_fee + service_fee - discount_total
        final_total = to_money_decimal(max(Decimal("0.00"), total_calculated))

        return OrderQuote(
            items=tuple(item_quotes),
            subtotal=items_subtotal,
            modifiers_total=modifiers_total,
            coupon_discount=coupon_discount,
            cashback_discount=cashback_discount,
            discount_total=discount_total,
            delivery_fee=delivery_fee,
            service_fee=service_fee,
            total=final_total,
        )
