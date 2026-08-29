"""Serviços compartilhados da borda pública para pedidos e cardápio digital."""

from .rate_limit import (
    MAX_PUBLIC_ORDERS_PER_IP,
    MAX_PUBLIC_ORDERS_PER_PHONE,
    PUBLIC_ORDER_RATE_WINDOW_SECONDS,
    client_ip,
    consume_rate_limit,
    enforce_public_order_rate_limits,
)
from .tenant_resolution import resolve_restaurant_id
from .customer_auth import authenticated_customer

__all__ = [
    "MAX_PUBLIC_ORDERS_PER_IP",
    "MAX_PUBLIC_ORDERS_PER_PHONE",
    "PUBLIC_ORDER_RATE_WINDOW_SECONDS",
    "client_ip",
    "consume_rate_limit",
    "enforce_public_order_rate_limits",
    "resolve_restaurant_id",
    "authenticated_customer",
]
