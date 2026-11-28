"""In-memory operational health snapshot for the engineering MCP (zero database queries)."""

from __future__ import annotations

from datetime import datetime, timezone
import os
from typing import Any

from sqlalchemy.pool import QueuePool

from .database import engine as default_engine
from .database_diagnostics import get_pool_metrics_snapshot


def _deployment_commit() -> str | None:
    commit = (
        os.getenv("RAILWAY_GIT_COMMIT_SHA")
        or os.getenv("GIT_COMMIT_SHA")
        or ""
    ).strip()
    return commit[:12] or None


def _count_websocket_connections(ws_manager: Any) -> int:
    active_connections = getattr(ws_manager, "active_connections", None)
    if not isinstance(active_connections, dict):
        return 0
    total = 0
    for buckets in active_connections.values():
        if isinstance(buckets, dict):
            total += sum(len(entries) for entries in buckets.values())
        else:
            total += len(buckets)
    return int(total)


def _db_pool_flow(target_engine: Any) -> dict[str, Any]:
    pool = getattr(target_engine, "pool", None)
    metrics = get_pool_metrics_snapshot(target_engine)
    if not isinstance(pool, QueuePool):
        return {
            "status": "unknown",
            "source": "sqlalchemy_pool_metadata",
            "metrics": metrics,
        }

    pool_size = int(metrics.get("pool_size") or 0)
    checked_out = int(metrics.get("checked_out") or 0)
    wait_timeouts_total = int(metrics.get("wait_timeouts_total") or 0)
    wait_ms = metrics.get("wait_ms")
    wait_p95 = float(wait_ms.get("p95") or 0.0) if isinstance(wait_ms, dict) else 0.0

    degraded = (
        wait_timeouts_total > 0
        or (pool_size > 0 and checked_out >= pool_size)
        or wait_p95 >= 500.0
    )
    return {
        "status": "degraded" if degraded else "normal",
        "source": "sqlalchemy_queue_pool_telemetry",
        "metrics": metrics,
    }


def _realtime_websocket_flow(ws_manager: Any, target_engine: Any) -> dict[str, Any]:
    if ws_manager is None:
        return {
            "status": "unknown",
            "source": "websocket_manager_memory",
            "active_connections": 0,
            "transport_connected": None,
            "generation": 0,
            "instance": "local",
        }

    bus = getattr(ws_manager, "bus", None)
    dialect_name = getattr(getattr(target_engine, "dialect", None), "name", None)
    ready_event = getattr(bus, "ready", None) if bus is not None else None
    is_ready = bool(ready_event.is_set()) if ready_event is not None else False

    if dialect_name == "postgresql":
        if bus is None:
            status = "unknown"
            transport_connected: bool | None = None
        elif is_ready:
            status = "normal"
            transport_connected = True
        else:
            status = "degraded"
            transport_connected = False
    else:
        status = "normal"
        transport_connected = True if bus is None else is_ready

    instance_id = getattr(bus, "instance_id", None) if bus is not None else None
    return {
        "status": status,
        "source": "websocket_manager_memory",
        "active_connections": _count_websocket_connections(ws_manager),
        "transport_connected": transport_connected,
        "generation": int(getattr(bus, "generation", 0) or 0) if bus is not None else 0,
        "instance": str(instance_id)[:8] if instance_id else "local",
    }


def _outbox_worker_flow(outbox_worker: Any) -> dict[str, Any]:
    enabled_by_env = (
        os.getenv("ENABLE_OUTBOX_WORKER", "true").strip().lower() == "true"
        and os.getenv("ENVIRONMENT", "").strip().lower() != "test"
    )
    is_running = bool(getattr(outbox_worker, "is_running", False))
    worker_id = getattr(outbox_worker, "worker_id", None)

    payload: dict[str, Any] = {
        "status": "unknown",
        "source": "outbox_worker_memory",
        "is_running": is_running,
        "worker_id": str(worker_id) if worker_id else None,
    }
    if is_running:
        payload["status"] = "normal"
    elif enabled_by_env:
        payload["status"] = "degraded"
    else:
        payload["reason"] = "disabled_by_environment"
    return payload


def build_in_memory_system_health(
    *,
    target_engine: Any = None,
    ws_manager: Any = None,
    outbox_worker: Any = None,
    commit: str | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Build an operational health summary from in-memory signals without DB I/O."""
    resolved_engine = default_engine if target_engine is None else target_engine

    if ws_manager is None:
        from .websocket_manager import manager as default_ws_manager

        resolved_ws_manager = default_ws_manager
    else:
        resolved_ws_manager = ws_manager

    if outbox_worker is None:
        from .services.outbox import default_outbox_worker

        resolved_outbox_worker = default_outbox_worker
    else:
        resolved_outbox_worker = outbox_worker

    observed_at = (now or datetime.now(timezone.utc)).isoformat()
    flows = {
        "db_pool": _db_pool_flow(resolved_engine),
        "realtime_websocket": _realtime_websocket_flow(resolved_ws_manager, resolved_engine),
        "outbox_worker": _outbox_worker_flow(resolved_outbox_worker),
    }

    flow_statuses = {flow["status"] for flow in flows.values()}
    if "degraded" in flow_statuses:
        overall_status = "degraded"
    elif flow_statuses == {"normal"}:
        overall_status = "normal"
    else:
        overall_status = "unknown"

    return {
        "overall_status": overall_status,
        "observed_at": observed_at,
        "commit": commit if commit is not None else _deployment_commit(),
        "flows": flows,
        "coverage": {
            "db_queries_executed": 0,
            "process_local_only": True,
            "observed_flows": ["db_pool", "realtime_websocket", "outbox_worker"],
            "not_covered": [
                "database_live_ping",
                "checkout_business_outcomes",
                "print_queue_backlog",
                "physical_paper_output",
            ],
        },
    }
