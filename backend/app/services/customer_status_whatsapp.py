"""Pure consent checks for future customer status notifications.

Consent is captured per order. A phone number typed into a public form does
not prove that its owner requested automated WhatsApp updates.

No provider I/O happens here. Messaging must remain disabled until an
approved utility-template sender and persistent delivery pipeline exist.
"""
from __future__ import annotations

from typing import Any

from .tenant_order_whatsapp import phones_match


def verified_checkout_consent(
    *,
    requested: bool,
    customer_token: str | None,
    customer: Any | None,
) -> bool:
    """Reject unauthenticated and unverified consent claims, default off."""
    return bool(
        requested is True
        and customer_token
        and customer is not None
        and getattr(customer, "telefone_verificado_em", None) is not None
        and getattr(customer, "telefone", None)
    )


def eligible_order_status_recipient(
    *,
    restaurant_id: int,
    order: Any,
    customer: Any | None,
) -> bool:
    """Fail closed if tenant, authenticated identity or telephone diverges.

    No message is enqueued or sent by this function. A future dispatcher will
    also need fresh opt-out and provider authorization checks.
    """
    if customer is None or not bool(getattr(order, "whatsapp_status_opt_in", False)):
        return False
    if int(getattr(order, "restaurante_id", -1)) != int(restaurant_id):
        return False
    if int(getattr(customer, "restaurante_id", -1)) != int(restaurant_id):
        return False
    if getattr(order, "cliente_id", None) != getattr(customer, "id", None):
        return False
    if getattr(customer, "telefone_verificado_em", None) is None:
        return False
    return phones_match(
        getattr(order, "delivery_telefone", None),
        getattr(customer, "telefone", None),
    )
