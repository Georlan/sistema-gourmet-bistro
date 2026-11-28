"""Authoritative read-only engineering MCP queries for checkout outcomes and print flow."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import case, func, text
from sqlalchemy.orm import Session

from .database import tenant_session_scope
from .mcp_db_guard import DEFAULT_STATEMENT_TIMEOUT_MS, configure_readonly_tx
from .models import Comanda, PrintAgentToken, PrintJob

ALLOWED_CHECKOUT_WINDOWS = (15, 60, 1440)
AGENT_ONLINE_THRESHOLD_SECONDS = 90
PRINT_DELAY_THRESHOLD_SECONDS = 120
PRINT_RECENT_WINDOW_MINUTES = 60

_ACCEPTED_DELIVERY_STATUSES = ("aceito", "producao", "pronto", "transito", "finalizado")
_AWAITING_DELIVERY_STATUSES = ("analise", "pendente")
_ONLINE_PENDING_STATUSES = ("pending", "pending_released")
_ONLINE_FAILED_STATUSES = ("rejected", "cancelled", "expired", "error")


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _query_cutoff(db: Session, dt: datetime) -> datetime:
    bind = db.get_bind()
    if bind is not None and bind.dialect.name == "sqlite":
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt.astimezone(timezone.utc)


def _discover_restaurant_ids(db: Session) -> list[int]:
    bind = db.get_bind()
    if bind is not None and bind.dialect.name == "postgresql":
        rows = db.execute(
            text("SELECT id FROM koma_internal.list_public_restaurants() ORDER BY id")
        ).scalars().all()
    else:
        rows = db.execute(text("SELECT id FROM restaurantes ORDER BY id")).scalars().all()
    return [int(row) for row in rows if row is not None and int(row) > 0]


def get_checkout_outcomes(
    db: Session,
    *,
    window_minutes: int = 60,
    now: datetime | None = None,
    statement_timeout_ms: int = DEFAULT_STATEMENT_TIMEOUT_MS,
) -> dict[str, Any]:
    """Aggregate persisted order and online payment outcomes across tenants without PII or IDs."""
    if isinstance(window_minutes, bool) or not isinstance(window_minutes, int) or window_minutes not in ALLOWED_CHECKOUT_WINDOWS:
        return {
            "status": "unknown",
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "window_minutes must be one of 15, 60, or 1440.",
                "retryable": False,
            },
        }

    ref_now = _as_utc(now) or datetime.now(timezone.utc)
    cutoff = _query_cutoff(db, ref_now - timedelta(minutes=window_minutes))
    restaurant_ids = _discover_restaurant_ids(db)

    total_orders = 0
    accepted_or_progressed = 0
    awaiting_acceptance = 0
    refused = 0
    in_store_or_untracked = 0
    online_approved = 0
    online_pending = 0
    online_failed = 0
    tenants_with_activity = 0

    for rid in restaurant_ids:
        with tenant_session_scope(db, rid):
            configure_readonly_tx(db, statement_timeout_ms=statement_timeout_ms)
            row = (
                db.query(
                    func.count(Comanda.id),
                    func.coalesce(
                        func.sum(case((Comanda.delivery_status.in_(_ACCEPTED_DELIVERY_STATUSES), 1), else_=0)),
                        0,
                    ),
                    func.coalesce(
                        func.sum(case((Comanda.delivery_status.in_(_AWAITING_DELIVERY_STATUSES), 1), else_=0)),
                        0,
                    ),
                    func.coalesce(
                        func.sum(case((Comanda.delivery_status == "recusado", 1), else_=0)),
                        0,
                    ),
                    func.coalesce(
                        func.sum(case((Comanda.delivery_status.is_(None), 1), else_=0)),
                        0,
                    ),
                    func.coalesce(
                        func.sum(case((Comanda.online_payment_status == "approved", 1), else_=0)),
                        0,
                    ),
                    func.coalesce(
                        func.sum(case((Comanda.online_payment_status.in_(_ONLINE_PENDING_STATUSES), 1), else_=0)),
                        0,
                    ),
                    func.coalesce(
                        func.sum(case((Comanda.online_payment_status.in_(_ONLINE_FAILED_STATUSES), 1), else_=0)),
                        0,
                    ),
                )
                .filter(
                    Comanda.restaurante_id == rid,
                    Comanda.criado_em >= cutoff,
                    Comanda.onboarding_test.is_(False),
                )
                .one()
            )
            tenant_total = int(row[0] or 0)
            if tenant_total > 0:
                tenants_with_activity += 1
            total_orders += tenant_total
            accepted_or_progressed += int(row[1] or 0)
            awaiting_acceptance += int(row[2] or 0)
            refused += int(row[3] or 0)
            in_store_or_untracked += int(row[4] or 0)
            online_approved += int(row[5] or 0)
            online_pending += int(row[6] or 0)
            online_failed += int(row[7] or 0)

    status = "normal"
    if total_orders == 0:
        status = "normal"
    elif online_failed > 0 and online_approved == 0 and accepted_or_progressed == 0:
        status = "degraded"

    return {
        "status": status,
        "window_minutes": window_minutes,
        "observed_at": ref_now.isoformat(),
        "tenants_with_activity_count": tenants_with_activity,
        "persisted_orders": {
            "total": total_orders,
            "accepted_or_progressed": accepted_or_progressed,
            "awaiting_acceptance": awaiting_acceptance,
            "refused": refused,
            "in_store_or_untracked_delivery": in_store_or_untracked,
        },
        "online_payments": {
            "approved": online_approved,
            "pending_or_released": online_pending,
            "failed_or_cancelled": online_failed,
        },
        "coverage": {
            "source": "authoritative_database_readonly",
            "denominator_scope": "persisted_comandas_excluding_onboarding_test",
            "pre_persistence_failures_included": False,
            "cache_ttl_seconds": 20,
        },
    }


def get_print_flow_summary(
    db: Session,
    *,
    now: datetime | None = None,
    statement_timeout_ms: int = DEFAULT_STATEMENT_TIMEOUT_MS,
) -> dict[str, Any]:
    """Aggregate print queue backlog and agent liveness without mutating state or exposing tenant IDs."""
    ref_now = _as_utc(now) or datetime.now(timezone.utc)
    recent_cutoff = _query_cutoff(db, ref_now - timedelta(minutes=PRINT_RECENT_WINDOW_MINUTES))
    online_cutoff = ref_now - timedelta(seconds=AGENT_ONLINE_THRESHOLD_SECONDS)
    delay_cutoff = ref_now - timedelta(seconds=PRINT_DELAY_THRESHOLD_SECONDS)
    restaurant_ids = _discover_restaurant_ids(db)

    pending_count = 0
    claimed_count = 0
    printing_count = 0
    printed_last_60m = 0
    failed_last_60m = 0
    cancelled_last_60m = 0
    delayed_unresolved_jobs = 0
    oldest_unresolved_dt: datetime | None = None
    active_agents_total = 0
    agents_online = 0

    for rid in restaurant_ids:
        with tenant_session_scope(db, rid):
            configure_readonly_tx(db, statement_timeout_ms=statement_timeout_ms)

            job_counts = (
                db.query(
                    func.coalesce(func.sum(case((PrintJob.status == "pending", 1), else_=0)), 0),
                    func.coalesce(func.sum(case((PrintJob.status == "claimed", 1), else_=0)), 0),
                    func.coalesce(func.sum(case((PrintJob.status == "printing", 1), else_=0)), 0),
                    func.coalesce(
                        func.sum(
                            case(
                                (
                                    (PrintJob.status == "printed") & (PrintJob.created_at >= recent_cutoff),
                                    1,
                                ),
                                else_=0,
                            )
                        ),
                        0,
                    ),
                    func.coalesce(
                        func.sum(
                            case(
                                (
                                    (PrintJob.status == "failed") & (PrintJob.created_at >= recent_cutoff),
                                    1,
                                ),
                                else_=0,
                            )
                        ),
                        0,
                    ),
                    func.coalesce(
                        func.sum(
                            case(
                                (
                                    (PrintJob.status == "cancelled") & (PrintJob.created_at >= recent_cutoff),
                                    1,
                                ),
                                else_=0,
                            )
                        ),
                        0,
                    ),
                )
                .filter(PrintJob.restaurante_id == rid)
                .one()
            )
            pending_count += int(job_counts[0] or 0)
            claimed_count += int(job_counts[1] or 0)
            printing_count += int(job_counts[2] or 0)
            printed_last_60m += int(job_counts[3] or 0)
            failed_last_60m += int(job_counts[4] or 0)
            cancelled_last_60m += int(job_counts[5] or 0)

            unresolved_created = (
                db.query(PrintJob.created_at)
                .filter(
                    PrintJob.restaurante_id == rid,
                    PrintJob.status.in_(("pending", "claimed", "printing")),
                )
                .all()
            )
            for (created_raw,) in unresolved_created:
                created_utc = _as_utc(created_raw)
                if created_utc is None:
                    continue
                if created_utc < delay_cutoff:
                    delayed_unresolved_jobs += 1
                if oldest_unresolved_dt is None or created_utc < oldest_unresolved_dt:
                    oldest_unresolved_dt = created_utc

            agent_rows = (
                db.query(PrintAgentToken.last_seen_at)
                .filter(
                    PrintAgentToken.restaurante_id == rid,
                    PrintAgentToken.ativo.is_(True),
                )
                .all()
            )
            for (last_seen_raw,) in agent_rows:
                active_agents_total += 1
                last_seen_utc = _as_utc(last_seen_raw)
                if last_seen_utc is not None and last_seen_utc >= online_cutoff:
                    agents_online += 1

    agents_silent = max(0, active_agents_total - agents_online)
    oldest_age_seconds = (
        max(0, int((ref_now - oldest_unresolved_dt).total_seconds()))
        if oldest_unresolved_dt is not None
        else 0
    )

    unresolved_total = pending_count + claimed_count + printing_count
    status = "normal"
    if delayed_unresolved_jobs > 0 or failed_last_60m > 0 or (unresolved_total > 0 and agents_online == 0 and active_agents_total > 0):
        status = "degraded"

    return {
        "status": status,
        "observed_at": ref_now.isoformat(),
        "queue": {
            "pending": pending_count,
            "claimed": claimed_count,
            "printing": printing_count,
            "delayed_unresolved_jobs": delayed_unresolved_jobs,
            "oldest_unresolved_age_seconds": oldest_age_seconds,
            "printed_last_60m": printed_last_60m,
            "failed_last_60m": failed_last_60m,
            "cancelled_last_60m": cancelled_last_60m,
        },
        "agents": {
            "active_total": active_agents_total,
            "online_within_90s": agents_online,
            "silent": agents_silent,
        },
        "physical_output_verified": False,
        "physical_output_note": "Software job status and agent heartbeats do not prove physical paper output.",
        "coverage": {
            "source": "authoritative_database_readonly",
            "recent_window_minutes": PRINT_RECENT_WINDOW_MINUTES,
            "delay_threshold_seconds": PRINT_DELAY_THRESHOLD_SECONDS,
            "maintenance_writes_executed": False,
            "cache_ttl_seconds": 20,
        },
    }
