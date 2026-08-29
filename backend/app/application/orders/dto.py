"""DTOs de saída e leitura para a camada de aplicação de Pedidos."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Optional, Tuple


@dataclass(frozen=True)
class OrderModifierDTO:
    """Projeção de leitura de um modificador do item."""

    modifier_id: int
    name: str
    price: Decimal


@dataclass(frozen=True)
class OrderItemDTO:
    """Projeção de leitura de um item do pedido."""

    item_id: int
    product_id: int
    product_name: str
    quantity: Decimal
    unit_price: Decimal
    total_price: Decimal
    modifiers: Tuple[OrderModifierDTO, ...] = ()
    notes: Optional[str] = None
    status: str = "ativo"


@dataclass(frozen=True)
class CustomerDTO:
    """Projeção de leitura de dados do cliente."""

    id: Optional[int] = None
    name: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None


@dataclass(frozen=True)
class DeliveryDTO:
    """Projeção de leitura de dados de entrega."""

    address: Optional[str] = None
    fee: Decimal = Decimal("0.00")
    status: str = "waiting"
    courier_id: Optional[int] = None
    courier_name: Optional[str] = None
    estimated_minutes: Optional[int] = None


@dataclass(frozen=True)
class OrderDTO:
    """Projeção consolidada de um pedido para retorno aos canais/adapters."""

    order_id: int
    restaurant_id: int
    order_number: Optional[str]
    channel: str
    fulfillment: str
    status: str
    total: Decimal
    subtotal: Decimal
    discount: Decimal
    items: Tuple[OrderItemDTO, ...]
    customer: Optional[CustomerDTO] = None
    delivery: Optional[DeliveryDTO] = None
    table_id: Optional[int] = None
    check_id: Optional[int] = None
    created_at: Optional[str] = None
