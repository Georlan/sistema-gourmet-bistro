"""Durable, minimal WhatsApp usage counters.

No recipient, order identifier, message text, token, or provider response body
is persisted here. Measurements are UTC-monthly and tenant-scoped with FORCE RLS.
The shared Business total is the sum of authorized tenant aggregates.
"""
from __future__ import annotations

import datetime as dt
import os
from decimal import Decimal, InvalidOperation, ROUND_UP

from sqlalchemy.orm import Session

from ..models import WhatsAppUsageMetric


_FIELDS = frozenset({
    "attempts", "accepted", "failed", "discarded", "deferred",
    "queue_latency_total_ms", "queue_latency_samples",
    "estimated_customer_cost_brl",
})


def estimated_customer_unit_cost() -> Decimal | None:
    """Optional operator estimate. Missing/invalid tariff does not block delivery."""
    raw = os.getenv("KOMA_CUSTOMER_WA_UNIT_COST_BRL")
    if raw is None:
        return None
    try:
        value = Decimal(raw)
        if not value.is_finite() or value < 0:
            return None
        return value.quantize(Decimal("0.0001"), rounding=ROUND_UP)
    except (InvalidOperation, ValueError):
        return None


def increment(db: Session, rid: int, **changes: int | Decimal) -> None:
    """Atomic UPSERT works across workers and SQLite regression tests."""
    updates = {name: value for name, value in changes.items() if name in _FIELDS and value}
    if not updates:
        return
    month = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m")
    table = WhatsAppUsageMetric.__table__
    if db.get_bind().dialect.name == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    else:
        from sqlalchemy.dialects.sqlite import insert
    stmt = insert(table).values(restaurante_id=rid, month_utc=month, **updates)
    stmt = stmt.on_conflict_do_update(
        index_elements=[table.c.restaurante_id, table.c.month_utc],
        set_={name: table.c[name] + value for name, value in updates.items()},
    )
    db.execute(stmt)


def reserve_attempt(db: Session, rid: int, *, customer: bool, age_ms: int) -> None:
    unit = estimated_customer_unit_cost() if customer else None
    increment(
        db, rid, attempts=1,
        queue_latency_total_ms=max(0, min(int(age_ms), 86400000)),
        queue_latency_samples=1,
        estimated_customer_cost_brl=unit or Decimal("0"),
    )


def record_outcome(db: Session, rid: int, kind: str) -> None:
    if kind not in {"accepted", "failed", "discarded", "deferred"}:
        return
    increment(db, rid, **{kind: 1})
