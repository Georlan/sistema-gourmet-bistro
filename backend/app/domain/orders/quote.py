"""Value Objects imutáveis para cotações e precificação de pedidos.

Utiliza Decimal com precisão monetária exata.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True)
class ModifierQuote:
    """Cotação imutável de um adicional/modificador."""

    id: int
    name: str
    unit_price: Decimal


@dataclass(frozen=True)
class ItemQuote:
    """Cotação imutável de um item do pedido com seus adicionais calculados."""

    product_id: int
    name: str
    quantity: Decimal
    unit_price: Decimal
    modifiers: tuple[ModifierQuote, ...]
    subtotal: Decimal
    notes: str | None = None


@dataclass(frozen=True)
class OrderQuote:
    """Cotação financeira consolidada e imutável de um pedido."""

    items: tuple[ItemQuote, ...]
    subtotal: Decimal
    modifiers_total: Decimal
    discount_total: Decimal
    delivery_fee: Decimal
    service_fee: Decimal
    total: Decimal
