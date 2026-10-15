"""Voluntary per-order WhatsApp status opt-in, with zero outgoing sends.

Guest checkouts need no new account/OTP. Opt-in is self-declared, NOT proof
of ownership. The customer sender stays OFF pending opt-out, budgeting,
provider authorization and rate-limit rollout.
"""
from __future__ import annotations

from typing import Any

from .tenant_order_whatsapp import normalize_phone, phones_match


def checkout_status_consent(*, requested: bool, phone: str | None, fulfillment: str) -> bool:
    """Capture this checkout's checkbox only; never infer consent from login."""
    if requested is not True or fulfillment not in {"retirada", "delivery"}:
        return False
    try:
        normalize_phone(phone or "")
    except ValueError:
        return False
    return True


def eligible_order_status_recipient(
    *,
    restaurant_id: int,
    order: Any,
    customer: Any | None,
    opted_out: bool = False,
) -> bool:
    """Validate tenant, order consent and contact before any future dispatch.

    Guest orders have no associated Cliente. Never claim that the typed phone
    identifies a registered profile. Authenticated orders must match the actual
    same-tenant customer ID and phone. Further checks at dispatch are needed.
    """
    if opted_out or not bool(getattr(order, "whatsapp_status_opt_in", False)):
        return False
    if int(getattr(order, "restaurante_id", -1)) != int(restaurant_id):
        return False
    try:
        normalize_phone(getattr(order, "delivery_telefone", "") or "")
    except ValueError:
        return False
    customer_id = getattr(order, "cliente_id", None)
    if customer_id is None:
        return customer is None
    if customer is None:
        return False
    if int(getattr(customer, "restaurante_id", -1)) != int(restaurant_id):
        return False
    if str(customer_id) != str(getattr(customer, "id", None)):
        return False
    return phones_match(
        getattr(order, "delivery_telefone", None),
        getattr(customer, "telefone", None),
    )
