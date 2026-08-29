"""Módulo de Domínio de Pedidos do Kôma."""

from .types import (
    OrderChannel,
    FulfillmentType,
    OrderStatus,
    DeliveryStatus,
    normalize_to_fulfillment,
    to_legacy_fulfillment,
    normalize_to_order_status,
    to_legacy_order_status,
    normalize_to_delivery_status,
    to_legacy_delivery_status,
)
from .errors import (
    OrderDomainError,
    InvalidOrderStateError,
    InvalidOrderTransitionError,
    OrderValidationError,
    EmptyOrderItemsError,
    InvalidItemQuantityError,
    InvalidFulfillmentDetailsError,
    InvalidExternalReferenceError,
)
from .state_machine import (
    OrderStateMachine,
    OrderTransitionResult,
)
from .quote import (
    OrderQuote,
    ItemQuote,
    ModifierQuote,
)
from .events import (
    OrderDomainEvent,
    OrderCreated,
    OrderAccepted,
    OrderPreparing,
    OrderReady,
    OrderDispatched,
    OrderCompleted,
    OrderRejected,
    OrderCancelled,
)

__all__ = [
    "OrderChannel",
    "FulfillmentType",
    "OrderStatus",
    "DeliveryStatus",
    "normalize_to_fulfillment",
    "to_legacy_fulfillment",
    "normalize_to_order_status",
    "to_legacy_order_status",
    "normalize_to_delivery_status",
    "to_legacy_delivery_status",
    "OrderDomainError",
    "InvalidOrderStateError",
    "InvalidOrderTransitionError",
    "OrderValidationError",
    "EmptyOrderItemsError",
    "InvalidItemQuantityError",
    "InvalidFulfillmentDetailsError",
    "InvalidExternalReferenceError",
    "OrderStateMachine",
    "OrderTransitionResult",
    "OrderQuote",
    "ItemQuote",
    "ModifierQuote",
    "OrderDomainEvent",
    "OrderCreated",
    "OrderAccepted",
    "OrderPreparing",
    "OrderReady",
    "OrderDispatched",
    "OrderCompleted",
    "OrderRejected",
    "OrderCancelled",
]
