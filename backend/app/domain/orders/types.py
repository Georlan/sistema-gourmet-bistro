"""Tipos e vocabulário canônico do domínio de Pedidos (Kôma).

Define enums imutáveis e funções bidirecionais de compatibilidade com o legado.
"""

from __future__ import annotations

from enum import Enum


class StrEnum(str, Enum):
    """Compatibilidade retroativa de StrEnum para versões do Python."""

    def __str__(self) -> str:
        return self.value


class OrderChannel(StrEnum):
    """Canal que originou o pedido."""

    POS = "pos"
    WAITER = "waiter"
    WEB_CARDAPIO = "web_cardapio"
    QR_MESA = "qr_mesa"
    IFOOD = "ifood"
    NINE_NINE_FOOD = "99food"
    KEETA = "keeta"
    KIOSK = "kiosk"
    WHATSAPP = "whatsapp"
    API = "api"


class FulfillmentType(StrEnum):
    """Modalidade de atendimento e entrega do pedido."""

    DINE_IN = "dine_in"
    PICKUP = "pickup"
    DELIVERY = "delivery"


class OrderStatus(StrEnum):
    """Estado do ciclo de vida comercial e operacional do pedido."""

    PENDING = "pending"
    ACCEPTED = "accepted"
    PREPARING = "preparing"
    READY = "ready"
    DISPATCHED = "dispatched"
    COMPLETED = "completed"
    REJECTED = "rejected"
    CANCELLED = "cancelled"


class DeliveryStatus(StrEnum):
    """Estado do ciclo de vida logístico e de entrega."""

    WAITING = "waiting"
    ASSIGNED = "assigned"
    DISPATCHED = "dispatched"
    DELIVERED = "delivered"
    CANCELLED = "cancelled"


# ── Mapeamento Bidirecional Legado ↔ Canônico ────────────────────────────────

_LEGACY_FULFILLMENT_TO_CANONICAL = {
    "delivery": FulfillmentType.DELIVERY,
    "entrega": FulfillmentType.DELIVERY,
    "retirada": FulfillmentType.PICKUP,
    "viagem": FulfillmentType.PICKUP,
    "balcao": FulfillmentType.PICKUP,
    "balcão": FulfillmentType.PICKUP,
    "mesa": FulfillmentType.DINE_IN,
    "salao": FulfillmentType.DINE_IN,
    "salão": FulfillmentType.DINE_IN,
    "comanda": FulfillmentType.DINE_IN,
    "dine_in": FulfillmentType.DINE_IN,
    "pickup": FulfillmentType.PICKUP,
}

_CANONICAL_FULFILLMENT_TO_LEGACY = {
    FulfillmentType.DELIVERY: "delivery",
    FulfillmentType.PICKUP: "retirada",
    FulfillmentType.DINE_IN: "mesa",
}

_LEGACY_STATUS_TO_CANONICAL = {
    "pendente": OrderStatus.PENDING,
    "analise": OrderStatus.PENDING,
    "recebido": OrderStatus.PENDING,
    "pending": OrderStatus.PENDING,
    "aceito": OrderStatus.ACCEPTED,
    "accepted": OrderStatus.ACCEPTED,
    "producao": OrderStatus.PREPARING,
    "preparando": OrderStatus.PREPARING,
    "em_preparo": OrderStatus.PREPARING,
    "preparing": OrderStatus.PREPARING,
    "pronto": OrderStatus.READY,
    "ready": OrderStatus.READY,
    "transito": OrderStatus.DISPATCHED,
    "saiu_entrega": OrderStatus.DISPATCHED,
    "dispatched": OrderStatus.DISPATCHED,
    "finalizado": OrderStatus.COMPLETED,
    "concluido": OrderStatus.COMPLETED,
    "concluído": OrderStatus.COMPLETED,
    "entregue": OrderStatus.COMPLETED,
    "completed": OrderStatus.COMPLETED,
    "recusado": OrderStatus.REJECTED,
    "rejected": OrderStatus.REJECTED,
    "cancelado": OrderStatus.CANCELLED,
    "cancelled": OrderStatus.CANCELLED,
}

_CANONICAL_STATUS_TO_LEGACY = {
    OrderStatus.PENDING: "pendente",
    OrderStatus.ACCEPTED: "producao",
    OrderStatus.PREPARING: "producao",
    OrderStatus.READY: "pronto",
    OrderStatus.DISPATCHED: "transito",
    OrderStatus.COMPLETED: "finalizado",
    OrderStatus.REJECTED: "recusado",
    OrderStatus.CANCELLED: "recusado",
}

_LEGACY_DELIVERY_STATUS_TO_CANONICAL = {
    "pendente": DeliveryStatus.WAITING,
    "aguardando": DeliveryStatus.WAITING,
    "waiting": DeliveryStatus.WAITING,
    "atribuido": DeliveryStatus.ASSIGNED,
    "atribuído": DeliveryStatus.ASSIGNED,
    "assigned": DeliveryStatus.ASSIGNED,
    "transito": DeliveryStatus.DISPATCHED,
    "saiu_entrega": DeliveryStatus.DISPATCHED,
    "dispatched": DeliveryStatus.DISPATCHED,
    "entregue": DeliveryStatus.DELIVERED,
    "finalizado": DeliveryStatus.DELIVERED,
    "delivered": DeliveryStatus.DELIVERED,
    "cancelado": DeliveryStatus.CANCELLED,
    "recusado": DeliveryStatus.CANCELLED,
    "cancelled": DeliveryStatus.CANCELLED,
}

_CANONICAL_DELIVERY_STATUS_TO_LEGACY = {
    DeliveryStatus.WAITING: "pendente",
    DeliveryStatus.ASSIGNED: "pendente",
    DeliveryStatus.DISPATCHED: "transito",
    DeliveryStatus.DELIVERED: "entregue",
    DeliveryStatus.CANCELLED: "recusado",
}


def normalize_to_fulfillment(value: str | FulfillmentType | None) -> FulfillmentType:
    """Traduz string legada de modalidade para FulfillmentType canônico."""
    if isinstance(value, FulfillmentType):
        return value
    if not value:
        return FulfillmentType.DINE_IN
    normalized = str(value).strip().casefold()
    return _LEGACY_FULFILLMENT_TO_CANONICAL.get(normalized, FulfillmentType.DINE_IN)


def to_legacy_fulfillment(fulfillment: FulfillmentType) -> str:
    """Traduz FulfillmentType canônico para string legada do banco."""
    return _CANONICAL_FULFILLMENT_TO_LEGACY.get(fulfillment, "mesa")


def normalize_to_order_status(value: str | OrderStatus | None) -> OrderStatus:
    """Traduz string legada de status para OrderStatus canônico."""
    if isinstance(value, OrderStatus):
        return value
    if not value:
        return OrderStatus.PENDING
    normalized = str(value).strip().casefold()
    return _LEGACY_STATUS_TO_CANONICAL.get(normalized, OrderStatus.PENDING)


def to_legacy_order_status(status: OrderStatus) -> str:
    """Traduz OrderStatus canônico para string legada do banco."""
    return _CANONICAL_STATUS_TO_LEGACY.get(status, "pendente")


def normalize_to_delivery_status(value: str | DeliveryStatus | None) -> DeliveryStatus:
    """Traduz string legada de entrega para DeliveryStatus canônico."""
    if isinstance(value, DeliveryStatus):
        return value
    if not value:
        return DeliveryStatus.WAITING
    normalized = str(value).strip().casefold()
    return _LEGACY_DELIVERY_STATUS_TO_CANONICAL.get(normalized, DeliveryStatus.WAITING)


def to_legacy_delivery_status(status: DeliveryStatus) -> str:
    """Traduz DeliveryStatus canônico para string legada do banco."""
    return _CANONICAL_DELIVERY_STATUS_TO_LEGACY.get(status, "pendente")


def sequence_to_letters(sequence: int) -> str:
    """Traduz sequência numérica para sufixo alfabético canônico: 1=A, 2=B, 26=Z, 27=AA."""
    if sequence < 1:
        raise ValueError("A sequência deve ser estritamente positiva.")
    result = ""
    value = sequence
    while value:
        value, remainder = divmod(value - 1, 26)
        result = chr(ord("A") + remainder) + result
    return result


def format_order_family_id(numero_conta: int | str, sequence: int = 1) -> str:
    """Formata o identificador operacional canônico por família de comanda (ex: '24-A', '24-B')."""
    return f"{numero_conta}-{sequence_to_letters(sequence)}"
