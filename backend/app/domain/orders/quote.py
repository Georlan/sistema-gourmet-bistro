"""Value Objects imutáveis para cotações e precificação de pedidos.

Utiliza Decimal com precisão monetária exata.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True)
class ModifierQuote:
    """Cotação imutável de um adicional/modificador."""

    id: str | int
    name: str
    unit_price: Decimal

    def to_float_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "unit_price": float(self.unit_price),
        }


@dataclass(frozen=True)
class ItemQuote:
    """Cotação imutável de um item do pedido com seus adicionais calculados."""

    product_id: str | int
    name: str
    quantity: Decimal
    unit_price: Decimal
    modifiers: tuple[ModifierQuote, ...]
    subtotal: Decimal
    notes: str | None = None

    def to_float_dict(self) -> dict:
        return {
            "product_id": self.product_id,
            "name": self.name,
            "quantity": float(self.quantity),
            "unit_price": float(self.unit_price),
            "modifiers": [m.to_float_dict() for m in self.modifiers],
            "subtotal": float(self.subtotal),
            "notes": self.notes,
        }


@dataclass(frozen=True)
class OrderQuote:
    """Cotação financeira consolidada e imutável de um pedido."""

    items: tuple[ItemQuote, ...]
    subtotal: Decimal
    modifiers_total: Decimal
    coupon_discount: Decimal
    cashback_discount: Decimal
    discount_total: Decimal
    delivery_fee: Decimal
    service_fee: Decimal
    total: Decimal

    def to_float_dict(self) -> dict:
        return {
            "items": [item.to_float_dict() for item in self.items],
            "subtotal": float(self.subtotal),
            "modifiers_total": float(self.modifiers_total),
            "coupon_discount": float(self.coupon_discount),
            "cashback_discount": float(self.cashback_discount),
            "discount_total": float(self.discount_total),
            "delivery_fee": float(self.delivery_fee),
            "service_fee": float(self.service_fee),
            "total": float(self.total),
        }
