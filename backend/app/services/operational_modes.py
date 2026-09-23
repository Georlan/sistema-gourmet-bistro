"""Canonical fulfillment-mode policy shared by onboarding and runtime."""

from __future__ import annotations

from typing import Iterable

from ..models import ConfiguracaoRestaurante

ALLOWED_ORDER_TYPES = ("consumo_local", "retirada", "delivery")


def normalize_active_order_types(raw: object) -> list[str] | None:
    """Return explicit policy, or None when the tenant is still on legacy behavior."""
    if raw is None:
        return None
    if not isinstance(raw, (list, tuple)):
        return []
    allowed = set(ALLOWED_ORDER_TYPES)
    normalized: list[str] = []
    for value in raw:
        item = str(value or "").strip().lower()
        if item in {"balcao", "balcão"}:
            item = "retirada"
        if item in allowed and item not in normalized:
            normalized.append(item)
    return normalized


def explicit_order_types(config: ConfiguracaoRestaurante | None) -> list[str] | None:
    if config is None:
        return None
    return normalize_active_order_types(getattr(config, "tipos_pedido_ativos", None))


def mode_is_allowed(config: ConfiguracaoRestaurante | None, mode: str) -> bool:
    """Legacy NULL keeps previous runtime behavior; explicit policy is authoritative."""
    explicit = explicit_order_types(config)
    if explicit is None:
        return True
    return mode in explicit


def canonical_order_type_from_comanda(tipo: object) -> str | None:
    normalized = str(tipo or "").strip().lower()
    if normalized in {"retirada"}:
        return "retirada"
    if normalized in {"delivery", "entrega"}:
        return "delivery"
    if normalized in {"consumo no local"}:
        return "consumo_local"
    return None


def any_active_mode_matches(order_types: Iterable[str], comanda_tipo: object) -> bool:
    mode = canonical_order_type_from_comanda(comanda_tipo)
    return bool(mode and mode in set(order_types))
