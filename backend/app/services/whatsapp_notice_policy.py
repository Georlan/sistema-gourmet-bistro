"""Shared KÔMA WhatsApp notice policy (no network sends).

All decisions consume canonical order events or the latest persisted order
status. No polling, WhatsApp status queries, or standalone worker is needed.

This module does not enable consumer messaging, which remains behind a
separate explicit consent and transport rollout.
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from decimal import Decimal, ROUND_DOWN
from enum import Enum

from ..domain.orders.types import FulfillmentType, OrderStatus, normalize_to_fulfillment, normalize_to_order_status


class NoticeKind(str, Enum):
    OPERATOR_NEW_ORDER = "operator_new_order"
    CUSTOMER_RECEIVED = "customer_received"
    CUSTOMER_READY_PICKUP = "customer_ready_pickup"
    CUSTOMER_DISPATCHED = "customer_dispatched"
    CUSTOMER_CANCELLED = "customer_cancelled"


# Operator notices go to the restaurant first. Customer cancellation is
# exceptional, followed by fulfillment, then the optional received update.
NOTICE_PRIORITY = {
    NoticeKind.OPERATOR_NEW_ORDER: 0,
    NoticeKind.CUSTOMER_CANCELLED: 1,
    NoticeKind.CUSTOMER_READY_PICKUP: 2,
    NoticeKind.CUSTOMER_DISPATCHED: 2,
    NoticeKind.CUSTOMER_RECEIVED: 3,
}

_CANONICAL_EVENTS = {
    "koma.order.created": NoticeKind.CUSTOMER_RECEIVED,
    "koma.order.rejected": NoticeKind.CUSTOMER_CANCELLED,
    "koma.order.cancelled": NoticeKind.CUSTOMER_CANCELLED,
}

# Unknown state must fail closed rather than be interpreted as "pending"
# by the general-purpose domain normalizer.
_RECOGNIZED_STATES = frozenset({
    "pendente", "analise", "recebido", "pending",
    "aceito", "accepted", "producao", "preparando", "em_preparo", "preparing",
    "pronto", "ready", "transito", "saiu_entrega", "dispatched",
    "finalizado", "concluido", "concluído", "entregue", "completed",
    "recusado", "rejected", "cancelado", "cancelled",
})


def _safe_status(value: str | OrderStatus | None) -> OrderStatus | None:
    if isinstance(value, OrderStatus):
        return value
    raw = str(value or "").strip().casefold()
    return normalize_to_order_status(raw) if raw in _RECOGNIZED_STATES else None


def customer_notice_for_event(
    *,
    event_name: str,
    fulfillment: str | FulfillmentType,
    online_order: bool,
    operationally_released: bool,
) -> NoticeKind | None:
    """At most one intended customer notice for a *canonical* event.

    A delivery order becoming READY is not a dispatched order; neither does
    ACCEPTED/PREPARING or COMPLETED produce a second operational notice.
    """
    if not online_order or not operationally_released:
        return None
    modality = normalize_to_fulfillment(fulfillment)
    if modality not in {FulfillmentType.PICKUP, FulfillmentType.DELIVERY}:
        return None
    kind = _CANONICAL_EVENTS.get(event_name)
    if kind is not None:
        return kind
    if event_name == "koma.order.ready" and modality == FulfillmentType.PICKUP:
        return NoticeKind.CUSTOMER_READY_PICKUP
    if event_name == "koma.order.dispatched" and modality == FulfillmentType.DELIVERY:
        return NoticeKind.CUSTOMER_DISPATCHED
    return None


def still_relevant(
    *,
    kind: NoticeKind,
    latest_status: str | OrderStatus | None,
    fulfillment: str | FulfillmentType,
    queued_at: dt.datetime,
    now: dt.datetime,
    max_age_minutes: int = 10,
) -> bool:
    """Do not notify outdated states. Called immediately before delivery.

    A stale received notice after READY/CANCELLED is discarded, not converted
    into a new text. The new canonical transition can produce its own event.
    """
    if not isinstance(queued_at, dt.datetime) or not isinstance(now, dt.datetime):
        return False
    if queued_at.tzinfo is None or now.tzinfo is None:
        return False
    age = now - queued_at
    if age < dt.timedelta(0) or age > dt.timedelta(minutes=max(1, max_age_minutes)):
        return False
    state = _safe_status(latest_status)
    if state is None:
        return False
    modality = normalize_to_fulfillment(fulfillment)
    if kind == NoticeKind.CUSTOMER_RECEIVED:
        return state in {OrderStatus.PENDING, OrderStatus.ACCEPTED, OrderStatus.PREPARING}
    if kind == NoticeKind.CUSTOMER_READY_PICKUP:
        return modality == FulfillmentType.PICKUP and state == OrderStatus.READY
    if kind == NoticeKind.CUSTOMER_DISPATCHED:
        return modality == FulfillmentType.DELIVERY and state == OrderStatus.DISPATCHED
    if kind == NoticeKind.CUSTOMER_CANCELLED:
        return state in {OrderStatus.REJECTED, OrderStatus.CANCELLED}
    return False


@dataclass(frozen=True)
class NoticeBudgetEstimate:
    orders_month: int
    messages_month: int
    projected_cost_brl: Decimal
    affordable_messages: int
    coverage_percent: Decimal


def estimate_customer_notice_budget(
    *,
    orders_per_day: int,
    days: int = 30,
    opt_in_fraction: Decimal = Decimal("1"),
    notices_per_order: int = 2,
    unit_cost_brl: Decimal,
    monthly_budget_brl: Decimal = Decimal("10"),
) -> NoticeBudgetEstimate:
    """Planning only. No implicit real-money billing or API send authorization.

    Unit cost comes from an explicitly configured provider tariff, not a
    hardcoded or assumed Meta rate. Coverage counts messages, not customers.
    """
    if orders_per_day < 0 or days < 1 or notices_per_order < 0:
        raise ValueError("Quantidade de pedidos e dias inválida.")
    if not 0 <= opt_in_fraction <= 1 or unit_cost_brl <= 0 or monthly_budget_brl < 0:
        raise ValueError("Custo, orçamento ou taxa de opt-in inválidos.")
    orders = orders_per_day * days
    messages = int(
        (Decimal(orders) * opt_in_fraction * Decimal(notices_per_order))
        .to_integral_value(rounding=ROUND_DOWN)
    )
    max_messages = int((monthly_budget_brl / unit_cost_brl).to_integral_value(rounding=ROUND_DOWN))
    coverage = (
        (Decimal(min(messages, max_messages)) / Decimal(messages) * Decimal("100"))
        .quantize(Decimal("0.1"))
        if messages else Decimal("100.0")
    )
    return NoticeBudgetEstimate(
        orders_month=orders,
        messages_month=messages,
        projected_cost_brl=(Decimal(messages) * unit_cost_brl).quantize(Decimal("0.01")),
        affordable_messages=max_messages,
        coverage_percent=coverage,
    )
