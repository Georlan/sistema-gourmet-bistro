"""Simulated traffic, durable metering, fairness and conservative pacing."""
import datetime as dt
from decimal import Decimal
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.models import Restaurante, WhatsAppUsageMetric
from app.services.outbox.dispatcher import fair_claim_candidates
from app.services.whatsapp_notice_policy import NoticeKind, still_relevant
from app.services.whatsapp_sender_gate import minimum_interval_seconds
from app.services.whatsapp_usage import (
    estimated_customer_unit_cost, record_outcome, reserve_attempt,
)


def test_pacing_never_allows_bursts_or_invalid_settings(monkeypatch):
    for raw, expected in (
        ("0", 15), ("-50", 15), ("oops", 15), ("12", 15),
        ("21", 21), ("600", 120),
    ):
        monkeypatch.setenv("KOMA_CENTRAL_WA_MIN_INTERVAL_SECONDS", raw)
        assert minimum_interval_seconds() == expected
    monkeypatch.delenv("KOMA_CENTRAL_WA_MIN_INTERVAL_SECONDS")
    assert minimum_interval_seconds() == 15


def test_fair_claims_interleave_restaurants_without_reordering_priority():
    def event(rid, kind, num):
        return SimpleNamespace(
            restaurante_id=rid, event_name="koma.whatsapp.customer_status",
            payload={"kind": kind}, marker=num,
        )
    # One busy restaurant should not monopolize the bounded candidate pool.
    received = [event(701, "customer_received", i) for i in range(25)]
    received += [event(702, "customer_received", 25), event(703, "customer_received", 26)]
    chosen = fair_claim_candidates(received, 6)
    assert [e.restaurante_id for e in chosen[:3]] == [701, 702, 703]
    assert [e.marker for e in chosen if e.restaurante_id == 701] == [0, 1, 2, 3]
    mixed = [event(701, "customer_cancelled", 1), event(702, "customer_cancelled", 2),
             event(701, "customer_received", 3)]
    assert [e.marker for e in fair_claim_candidates(mixed, 3)] == [1, 2, 3]


def test_stale_received_drops_but_still_current_critical_milestones_have_more_time():
    now = dt.datetime.now(dt.timezone.utc)
    age = now - dt.timedelta(minutes=20)
    kwargs = {"fulfillment": "retirada", "queued_at": age, "now": now}
    assert not still_relevant(kind=NoticeKind.CUSTOMER_RECEIVED, latest_status="pendente", **kwargs)
    assert still_relevant(kind=NoticeKind.CUSTOMER_READY_PICKUP, latest_status="pronto", **kwargs)
    assert not still_relevant(kind=NoticeKind.CUSTOMER_READY_PICKUP,
                              latest_status="cancelado", **kwargs)
    assert not still_relevant(kind=NoticeKind.CUSTOMER_READY_PICKUP,
                              latest_status="pronto",
                              fulfillment="retirada",
                              queued_at=now - dt.timedelta(minutes=31), now=now)


def test_missing_or_bad_tariff_never_disables_customer_notices(monkeypatch):
    monkeypatch.delenv("KOMA_CUSTOMER_WA_UNIT_COST_BRL", raising=False)
    assert estimated_customer_unit_cost() is None
    monkeypatch.setenv("KOMA_CUSTOMER_WA_UNIT_COST_BRL", "not-a-price")
    assert estimated_customer_unit_cost() is None
    monkeypatch.setenv("KOMA_CUSTOMER_WA_UNIT_COST_BRL", "-3")
    assert estimated_customer_unit_cost() is None
    monkeypatch.setenv("KOMA_CUSTOMER_WA_UNIT_COST_BRL", "0.035")
    assert estimated_customer_unit_cost() == Decimal("0.0350")


def test_usage_survives_event_cleanup_and_is_separate_by_tenant(tmp_path, monkeypatch):
    monkeypatch.setenv("KOMA_CUSTOMER_WA_UNIT_COST_BRL", "0.035")
    engine = create_engine(f"sqlite:///{tmp_path}/usage.db")
    Base.metadata.create_all(engine)
    try:
        with Session(engine) as db:
            db.add_all([Restaurante(id=701, nome="Test one"), Restaurante(id=702, nome="Test two")])
            db.commit()
            reserve_attempt(db, 701, customer=True, age_ms=1500)
            record_outcome(db, 701, "accepted")
            record_outcome(db, 701, "discarded")
            reserve_attempt(db, 702, customer=False, age_ms=2800)
            record_outcome(db, 702, "failed")
            db.commit()
            a = db.query(WhatsAppUsageMetric).filter_by(restaurante_id=701).one()
            b = db.query(WhatsAppUsageMetric).filter_by(restaurante_id=702).one()
            assert (a.attempts, a.accepted, a.failed, a.discarded) == (1, 1, 0, 1)
            assert (b.attempts, b.accepted, b.failed, b.discarded) == (1, 0, 1, 0)
            assert a.queue_latency_total_ms == 1500
            assert b.queue_latency_total_ms == 2800
            assert a.estimated_customer_cost_brl == Decimal("0.0350")
            assert b.estimated_customer_cost_brl == Decimal("0.0000")
            assert not any(key in WhatsAppUsageMetric.__table__.columns.keys()
                           for key in ("phone", "message", "payload", "token"))
    finally:
        engine.dispose()
