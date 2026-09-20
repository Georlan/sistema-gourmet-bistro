from __future__ import annotations

from typing import Any


CANONICAL_ORDER_TYPES = ("consumo_local", "retirada", "delivery")

_FULFILLMENT_ALIASES = {
    "dine_in": "consumo_local",
    "consumo_local": "consumo_local",
    "consumo no local": "consumo_local",
    "local": "consumo_local",
    "pickup": "retirada",
    "retirada": "retirada",
    "viagem": "retirada",
    "delivery": "delivery",
    "entrega": "delivery",
}


def normalize_order_types(value: Any) -> list[str] | None:
    """Normalize an explicit policy. None keeps legacy runtime behavior."""
    if value is None:
        return None
    if not isinstance(value, (list, tuple, set)):
        return []
    raw = {str(item).strip().lower() for item in value}
    return [item for item in CANONICAL_ORDER_TYPES if item in raw]


def explicit_order_types(config: Any) -> list[str] | None:
    if config is None:
        return None
    return normalize_order_types(getattr(config, "tipos_pedido_ativos", None))


def fulfillment_order_type(fulfillment: Any) -> str | None:
    raw = getattr(fulfillment, "value", fulfillment)
    return _FULFILLMENT_ALIASES.get(str(raw or "").strip().lower())


def comanda_order_type(tipo: Any) -> str | None:
    return _FULFILLMENT_ALIASES.get(str(tipo or "").strip().lower())


def is_fulfillment_allowed(config: Any, fulfillment: Any) -> bool:
    configured = explicit_order_types(config)
    if configured is None:
        return True
    normalized = fulfillment_order_type(fulfillment)
    return normalized is not None and normalized in configured


def is_comanda_type_allowed(config: Any, tipo: Any) -> bool:
    configured = explicit_order_types(config)
    if configured is None:
        return True
    normalized = comanda_order_type(tipo)
    return normalized is not None and normalized in configured
