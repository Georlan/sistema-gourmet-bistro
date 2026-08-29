"""Serviço puro de validação de pedidos do Kôma (OrderValidationService).

Regras 100% puras (sem dependências de FastAPI, SQLAlchemy ou HTTPException).
Distingue estritamente Hard Validation (que impede a criação) de Eligibility (benefícios opcionais).
Garante isolamento multi-tenant e prepara o ValidatedOrderInput para o OrderPricingService.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Sequence

from .errors import (
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
from .pricing import (
    CouponPricingInput,
    ItemPricingInput,
    ModifierPricingInput,
    PricingContext,
    to_money_decimal,
    to_quantity_decimal,
)
from .types import FulfillmentType


@dataclass(frozen=True)
class ValidationProduct:
    """Informações mínimas de produto do catálogo necessárias para validação."""

    id: str | int
    restaurant_id: int
    name: str
    price: Decimal
    is_active: bool
    allowed_modifier_group_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class ValidationModifier:
    """Informações mínimas de modificador do catálogo necessárias para validação."""

    id: str | int
    group_id: str
    restaurant_id: int
    name: str
    price: Decimal
    is_active: bool


@dataclass(frozen=True)
class ValidationCoupon:
    """Informações mínimas de cupom necessárias para checagem de elegibilidade."""

    code: str
    discount_type: str
    discount_value: Decimal
    min_order_value: Decimal = Decimal("0.00")
    is_active: bool = True
    is_expired: bool = False
    is_usage_limit_reached: bool = False
    is_first_purchase_only: bool = False
    customer_has_previous_orders: bool = False


@dataclass(frozen=True)
class OrderValidationInputItem:
    """Item bruto de entrada submetido para validação."""

    product_id: str | int
    quantity: Decimal | int | float | str
    modifier_ids: tuple[str | int, ...] = ()
    notes: str | None = None


@dataclass(frozen=True)
class ValidationContext:
    """Contexto completo de entrada para validação de um pedido."""

    restaurant_id: int
    fulfillment: FulfillmentType
    items: tuple[OrderValidationInputItem, ...]
    catalog_products: dict[str, ValidationProduct]
    catalog_modifiers: dict[str, ValidationModifier] = field(default_factory=dict)
    delivery_address: str | None = None
    delivery_phone: str | None = None
    minimum_delivery_subtotal: Decimal = Decimal("0.00")
    coupon: ValidationCoupon | None = None
    available_cashback: Decimal = Decimal("0.00")
    apply_cashback: bool = False


@dataclass(frozen=True)
class ValidatedModifier:
    """Modificador validado e pronto para cálculo."""

    id: str | int
    name: str
    price: Decimal


@dataclass(frozen=True)
class ValidatedOrderItem:
    """Item de pedido estruturalmente validado com modificadores permitidos."""

    product_id: str | int
    name: str
    base_price: Decimal
    quantity: Decimal
    modifiers: tuple[ValidatedModifier, ...] = ()
    notes: str | None = None


@dataclass(frozen=True)
class CouponEligibility:
    """Resultado da checagem de elegibilidade do cupom (sem lançar erro no pedido)."""

    is_eligible: bool
    reason: str | None = None
    coupon_pricing_input: CouponPricingInput | None = None


@dataclass(frozen=True)
class CashbackEligibility:
    """Resultado da checagem de saldo e elegibilidade de cashback."""

    is_eligible: bool
    available_amount: Decimal = Decimal("0.00")


@dataclass(frozen=True)
class ValidatedOrderInput:
    """Pedido 100% validado pelo domínio, pronto para ser cotado e persistido."""

    restaurant_id: int
    fulfillment: FulfillmentType
    items: tuple[ValidatedOrderItem, ...]
    delivery_address: str | None = None
    delivery_phone: str | None = None
    coupon: CouponEligibility | None = None
    cashback: CashbackEligibility | None = None

    def to_pricing_context(
        self,
        delivery_fee: Decimal = Decimal("0.00"),
        service_tax_rate: Decimal = Decimal("0.00"),
    ) -> PricingContext:
        """Converte a estrutura validada para o PricingContext do OrderPricingService."""
        pricing_items: list[ItemPricingInput] = []
        for it in self.items:
            mod_inputs = tuple(
                ModifierPricingInput(
                    id=m.id,
                    name=m.name,
                    price=m.price,
                )
                for m in it.modifiers
            )
            pricing_items.append(
                ItemPricingInput(
                    product_id=it.product_id,
                    name=it.name,
                    base_price=it.base_price,
                    quantity=it.quantity,
                    modifiers=mod_inputs,
                    notes=it.notes,
                )
            )

        coupon_input = (
            self.coupon.coupon_pricing_input
            if self.coupon and self.coupon.is_eligible
            else None
        )
        available_cb = (
            self.cashback.available_amount
            if self.cashback and self.cashback.is_eligible
            else Decimal("0.00")
        )

        return PricingContext(
            fulfillment=self.fulfillment,
            items=tuple(pricing_items),
            delivery_fee=to_money_decimal(delivery_fee),
            coupon=coupon_input,
            available_cashback=available_cb,
            apply_cashback=available_cb > Decimal("0.00"),
            service_tax_rate=to_money_decimal(service_tax_rate),
        )


class OrderValidationService:
    """Motor puro de validação de pedidos do Kôma."""

    @classmethod
    def validate(cls, context: ValidationContext) -> ValidatedOrderInput:
        """Executa todas as validações estruturais, de catálogo, multi-tenant e de atendimento."""
        # 1. Validação Estrutural de Itens
        if not context.items:
            raise EmptyOrderItemsError()

        validated_items: list[ValidatedOrderItem] = []
        items_subtotal = Decimal("0.00")

        # 2. Validação de Cada Item e seus Modificadores
        for raw_item in context.items:
            qty = to_quantity_decimal(raw_item.quantity)
            if qty <= Decimal("0.00"):
                raise InvalidItemQuantityError(raw_item.product_id, raw_item.quantity)

            pid_key = str(raw_item.product_id)
            prod = context.catalog_products.get(pid_key)

            if prod is None:
                raise ProductNotFoundError(raw_item.product_id)

            if prod.restaurant_id != context.restaurant_id:
                raise ProductTenantMismatchError(
                    product_id=raw_item.product_id,
                    expected_tenant=context.restaurant_id,
                    actual_tenant=prod.restaurant_id,
                )

            if not prod.is_active:
                raise ProductInactiveError(raw_item.product_id)

            base_price = to_money_decimal(prod.price)

            # Validar Modificadores
            validated_modifiers: list[ValidatedModifier] = []
            item_modifiers_sum = Decimal("0.00")

            for mid in raw_item.modifier_ids:
                mid_key = str(mid)
                mod = context.catalog_modifiers.get(mid_key)

                if mod is None:
                    raise ModifierNotFoundError(mid)

                if mod.restaurant_id != context.restaurant_id:
                    raise ProductTenantMismatchError(
                        product_id=mid,
                        expected_tenant=context.restaurant_id,
                        actual_tenant=mod.restaurant_id,
                    )

                if not mod.is_active:
                    raise ModifierInactiveError(mid)

                # Se o produto possui grupos permitidos definidos, verificar vínculo
                if prod.allowed_modifier_group_ids and mod.group_id not in prod.allowed_modifier_group_ids:
                    raise ModifierGroupMismatchError(mid, prod.id)

                mod_price = to_money_decimal(mod.price)
                item_modifiers_sum += mod_price
                validated_modifiers.append(
                    ValidatedModifier(
                        id=mod.id,
                        name=mod.name,
                        price=mod_price,
                    )
                )

            unit_price = to_money_decimal(base_price + item_modifiers_sum)
            item_subtotal = to_money_decimal(unit_price * qty)
            items_subtotal += item_subtotal

            validated_items.append(
                ValidatedOrderItem(
                    product_id=prod.id,
                    name=prod.name,
                    base_price=base_price,
                    quantity=qty,
                    modifiers=tuple(validated_modifiers),
                    notes=raw_item.notes,
                )
            )

        items_subtotal = to_money_decimal(items_subtotal)

        # 3. Validação de Atendimento e Entrega
        if context.fulfillment == FulfillmentType.DELIVERY:
            if not context.delivery_address or not str(context.delivery_address).strip():
                raise InvalidFulfillmentDetailsError("Endereço de entrega é obrigatório para pedidos delivery.")
            if not context.delivery_phone or not str(context.delivery_phone).strip():
                raise InvalidFulfillmentDetailsError("Telefone de contato é obrigatório para pedidos delivery.")

            min_delivery = to_money_decimal(context.minimum_delivery_subtotal)
            if min_delivery > Decimal("0.00") and items_subtotal < min_delivery:
                raise MinimumOrderAmountNotMetError(
                    subtotal=items_subtotal,
                    minimum_amount=min_delivery,
                )

        # 4. Avaliação de Elegibilidade de Cupom (NÃO lança exceção)
        coupon_eligibility: CouponEligibility | None = None
        if context.coupon is not None:
            c = context.coupon
            min_order = to_money_decimal(c.min_order_value)
            if not c.is_active:
                coupon_eligibility = CouponEligibility(is_eligible=False, reason="Cupom desativado.")
            elif c.is_expired:
                coupon_eligibility = CouponEligibility(is_eligible=False, reason="Cupom expirado.")
            elif c.is_usage_limit_reached:
                coupon_eligibility = CouponEligibility(is_eligible=False, reason="Limite de utilizações atingido.")
            elif items_subtotal < min_order:
                coupon_eligibility = CouponEligibility(
                    is_eligible=False,
                    reason=f"Valor mínimo de R$ {min_order:.2f} não atingido (subtotal: R$ {items_subtotal:.2f}).",
                )
            elif c.is_first_purchase_only and c.customer_has_previous_orders:
                coupon_eligibility = CouponEligibility(is_eligible=False, reason="Válido apenas para o primeiro pedido.")
            else:
                coupon_pricing_input = CouponPricingInput(
                    code=c.code,
                    discount_type=c.discount_type,
                    discount_value=to_money_decimal(c.discount_value),
                    min_order_value=min_order,
                    is_active=True,
                    is_expired=False,
                    is_usage_limit_reached=False,
                    is_first_purchase_only=c.is_first_purchase_only,
                    customer_has_previous_orders=c.customer_has_previous_orders,
                )
                coupon_eligibility = CouponEligibility(
                    is_eligible=True,
                    reason="Cupom aplicado com sucesso.",
                    coupon_pricing_input=coupon_pricing_input,
                )

        # 5. Avaliação de Elegibilidade de Cashback
        cashback_eligibility: CashbackEligibility | None = None
        if context.apply_cashback and context.available_cashback > Decimal("0.00"):
            cashback_eligibility = CashbackEligibility(
                is_eligible=True,
                available_amount=to_money_decimal(context.available_cashback),
            )
        elif context.apply_cashback:
            cashback_eligibility = CashbackEligibility(
                is_eligible=False,
                available_amount=Decimal("0.00"),
            )

        return ValidatedOrderInput(
            restaurant_id=context.restaurant_id,
            fulfillment=context.fulfillment,
            items=tuple(validated_items),
            delivery_address=context.delivery_address,
            delivery_phone=context.delivery_phone,
            coupon=coupon_eligibility,
            cashback=cashback_eligibility,
        )
