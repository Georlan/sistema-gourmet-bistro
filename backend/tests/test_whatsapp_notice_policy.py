"""The WhatsApp policy must never poll, double-notify or exceed stated semantics."""
import datetime as dt
from decimal import Decimal

import pytest

from app.services.whatsapp_notice_policy import (
    NoticeKind,
    NOTICE_PRIORITY,
    customer_notice_for_event,
    estimate_customer_notice_budget,
    still_relevant,
)


@pytest.mark.parametrize(("event", "modality", "expected"), [
    ("koma.order.created", "retirada", NoticeKind.CUSTOMER_RECEIVED),
    ("koma.order.created", "entrega", NoticeKind.CUSTOMER_RECEIVED),
    ("koma.order.ready", "retirada", NoticeKind.CUSTOMER_READY_PICKUP),
    ("koma.order.ready", "entrega", None),
    ("koma.order.dispatched", "entrega", NoticeKind.CUSTOMER_DISPATCHED),
    ("koma.order.dispatched", "retirada", None),
    ("koma.order.rejected", "entrega", NoticeKind.CUSTOMER_CANCELLED),
    ("koma.order.cancelled", "retirada", NoticeKind.CUSTOMER_CANCELLED),
    ("koma.order.accepted", "retirada", None),
    ("koma.order.preparing", "entrega", None),
    ("koma.order.completed", "retirada", None),
])
def test_only_meaningful_transitions_trigger_one_intent(event, modality, expected):
    assert customer_notice_for_event(
        event_name=event, fulfillment=modality, online_order=True,
        operationally_released=True,
    ) == expected


def test_no_pending_pix_scheduled_or_nononline_notice():
    for event in ("koma.order.created", "koma.order.ready", "koma.order.cancelled"):
        assert customer_notice_for_event(
            event_name=event, fulfillment="retirada", online_order=True,
            operationally_released=False,
        ) is None
        assert customer_notice_for_event(
            event_name=event, fulfillment="retirada", online_order=False,
            operationally_released=True,
        ) is None


def test_latest_state_check_prevents_obsolete_received_notification():
    now = dt.datetime.now(dt.timezone.utc)
    old = now - dt.timedelta(minutes=2)
    for latest in ("pronto", "transito", "cancelado", "recusado", "finalizado", "???"):
        assert not still_relevant(
            kind=NoticeKind.CUSTOMER_RECEIVED, latest_status=latest,
            fulfillment="retirada", queued_at=old, now=now,
        )
    for valid in ("pendente", "aceito", "producao"):
        assert still_relevant(
            kind=NoticeKind.CUSTOMER_RECEIVED, latest_status=valid,
            fulfillment="retirada", queued_at=old, now=now,
        )


def test_no_duplicate_final_event_or_wrong_modality():
    now = dt.datetime.now(dt.timezone.utc)
    args = {"queued_at": now - dt.timedelta(seconds=3), "now": now}
    assert still_relevant(
        kind=NoticeKind.CUSTOMER_READY_PICKUP, latest_status="pronto",
        fulfillment="retirada", **args
    )
    assert not still_relevant(
        kind=NoticeKind.CUSTOMER_READY_PICKUP, latest_status="transito",
        fulfillment="entrega", **args
    )
    assert still_relevant(
        kind=NoticeKind.CUSTOMER_DISPATCHED, latest_status="saiu_entrega",
        fulfillment="entrega", **args
    )
    assert not still_relevant(
        kind=NoticeKind.CUSTOMER_DISPATCHED, latest_status="finalizado",
        fulfillment="entrega", **args
    )
    assert still_relevant(
        kind=NoticeKind.CUSTOMER_CANCELLED, latest_status="recusado",
        fulfillment="entrega", **args
    )
    assert not still_relevant(
        kind=NoticeKind.CUSTOMER_CANCELLED, latest_status="pronto",
        fulfillment="retirada", **args
    )


def test_age_and_clock_check_fail_closed():
    now = dt.datetime.now(dt.timezone.utc)
    kwargs={"kind": NoticeKind.CUSTOMER_RECEIVED, "latest_status": "pendente",
            "fulfillment": "retirada", "now": now}
    assert not still_relevant(queued_at=now-dt.timedelta(minutes=11), **kwargs)
    assert not still_relevant(queued_at=now+dt.timedelta(seconds=1), **kwargs)
    assert not still_relevant(queued_at=now.replace(tzinfo=None), **kwargs)


def test_cancellation_priority_above_final_and_received():
    assert NOTICE_PRIORITY[NoticeKind.OPERATOR_NEW_ORDER] < NOTICE_PRIORITY[NoticeKind.CUSTOMER_CANCELLED]
    assert NOTICE_PRIORITY[NoticeKind.CUSTOMER_CANCELLED] < NOTICE_PRIORITY[NoticeKind.CUSTOMER_READY_PICKUP]
    assert NOTICE_PRIORITY[NoticeKind.CUSTOMER_READY_PICKUP] < NOTICE_PRIORITY[NoticeKind.CUSTOMER_RECEIVED]


def test_budget_50_orders_per_day_ten_brl_with_example_tariff():
    estimate = estimate_customer_notice_budget(
        orders_per_day=50,
        unit_cost_brl=Decimal("0.035"),
        monthly_budget_brl=Decimal("10"),
    )
    assert estimate.orders_month == 1500
    assert estimate.messages_month == 3000
    assert estimate.projected_cost_brl == Decimal("105.00")
    assert estimate.affordable_messages == 285
    assert estimate.coverage_percent == Decimal("9.5")


def test_budget_no_orders_and_invalid_tariff():
    empty = estimate_customer_notice_budget(
        orders_per_day=0, unit_cost_brl=Decimal("0.1"),
    )
    assert empty.messages_month == 0
    assert empty.projected_cost_brl == 0
    assert empty.coverage_percent == Decimal("100.0")
    with pytest.raises(ValueError):
        estimate_customer_notice_budget(
            orders_per_day=50, unit_cost_brl=Decimal("0"),
        )
