"""Eventos de domínio puros do ciclo de vida de Pedidos.

Desacoplados de qualquer mecanismo de persistência, banco ou mensageria.
"""

from __future__ import annotations

import datetime
import uuid
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Optional
from .types import FulfillmentType, OrderChannel


@dataclass(frozen=True)
class OrderDomainEvent:
    """Evento base do domínio de pedidos."""

    restaurant_id: int
    order_id: int
    event_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    occurred_at: datetime.datetime = field(
        default_factory=lambda: datetime.datetime.now(datetime.timezone.utc)
    )


@dataclass(frozen=True)
class OrderCreated(OrderDomainEvent):
    """Emitido quando um novo pedido é registrado no sistema."""

    channel: OrderChannel = OrderChannel.POS
    fulfillment: FulfillmentType = FulfillmentType.DINE_IN
    total: Decimal = Decimal("0.00")
    items_count: int = 0
    table_id: Optional[int] = None
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    idempotency_key: Optional[str] = None
    external_provider: Optional[str] = None
    external_order_id: Optional[str] = None


@dataclass(frozen=True)
class OrderAccepted(OrderDomainEvent):
    """Emitido quando a operação aceita um pedido para produção."""

    operator_user_id: Optional[int] = None
    estimated_prep_minutes: Optional[int] = None


@dataclass(frozen=True)
class OrderPreparing(OrderDomainEvent):
    """Emitido quando a cozinha inicia o preparo."""

    operator_user_id: Optional[int] = None


@dataclass(frozen=True)
class OrderReady(OrderDomainEvent):
    """Emitido quando todos os itens estão prontos para entrega ou retirada."""

    fulfillment: FulfillmentType = FulfillmentType.DINE_IN
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None


@dataclass(frozen=True)
class OrderDispatched(OrderDomainEvent):
    """Emitido quando o pedido sai para entrega com o motoboy."""

    courier_id: Optional[int] = None
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None


@dataclass(frozen=True)
class OrderCompleted(OrderDomainEvent):
    """Emitido quando o pedido é concluído e entregue com sucesso."""

    operator_user_id: Optional[int] = None


@dataclass(frozen=True)
class OrderRejected(OrderDomainEvent):
    """Emitido quando um pedido pendente é recusado pelo restaurante."""

    reason: str = ""
    operator_user_id: Optional[int] = None
    customer_phone: Optional[str] = None


@dataclass(frozen=True)
class OrderCancelled(OrderDomainEvent):
    """Emitido quando um pedido já aceito precisa ser cancelado."""

    reason: str = ""
    operator_user_id: Optional[int] = None
    refunded_stock: bool = True
