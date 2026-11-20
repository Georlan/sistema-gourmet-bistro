"""Bounded pool diagnostics and wait/hold telemetry: metadata only, never SQL, arguments or credentials."""

from __future__ import annotations

from collections import deque
import json
import logging
import sys
import threading
from time import monotonic

from sqlalchemy import event
from sqlalchemy.exc import TimeoutError as SQLAlchemyTimeoutError
from sqlalchemy.pool import QueuePool

logger = logging.getLogger(__name__)
_KEY = "koma_checkout_diagnostic"
_TELEMETRY_ATTR = "_koma_pool_telemetry"
_DEFAULT_WINDOW_SIZE = 256


def _resolve_checkout_origin(max_depth: int = 30) -> str:
    """Resolve app-relative caller ``file:func`` walking CPython frames without linecache I/O."""
    getframe = getattr(sys, "_getframe", None)
    if not callable(getframe):
        return "unknown"
    try:
        frame = getframe(1)
    except ValueError:
        return "unknown"
    steps = 0
    while frame is not None and steps < max_depth:
        filename = frame.f_code.co_filename
        if "/app/" in filename or "\\app\\" in filename:
            normalized = filename.replace("\\", "/")
            if "/app/" in normalized and not normalized.endswith(
                ("database.py", "database_diagnostics.py")
            ):
                return normalized.rsplit("/app/", 1)[1] + ":" + frame.f_code.co_name
        frame = frame.f_back
        steps += 1
    return "unknown"


def _percentile(sorted_values: list[float], pct: float) -> float:
    if not sorted_values:
        return 0.0
    if len(sorted_values) == 1:
        return round(sorted_values[0], 2)
    rank = (pct / 100.0) * (len(sorted_values) - 1)
    lower = int(rank)
    upper = min(lower + 1, len(sorted_values) - 1)
    weight = rank - lower
    interpolated = sorted_values[lower] + (sorted_values[upper] - sorted_values[lower]) * weight
    return round(interpolated, 2)


def _summarize_window(samples: deque[float]) -> dict[str, float | int]:
    ordered = sorted(samples)
    if not ordered:
        return {"samples": 0, "p50": 0.0, "p95": 0.0, "max": 0.0}
    return {
        "samples": len(ordered),
        "p50": _percentile(ordered, 50.0),
        "p95": _percentile(ordered, 95.0),
        "max": round(ordered[-1], 2),
    }


class PoolTelemetry:
    """In-memory bounded ring-buffer telemetry for SQLAlchemy QueuePool wait and hold latencies."""

    def __init__(self, pool: QueuePool, *, window_size: int = _DEFAULT_WINDOW_SIZE) -> None:
        self._pool = pool
        self._lock = threading.Lock()
        self._wait_ms: deque[float] = deque(maxlen=max(16, int(window_size)))
        self._hold_ms: deque[float] = deque(maxlen=max(16, int(window_size)))
        self.checkouts_total = 0
        self.wait_timeouts_total = 0
        self.slow_waits_total = 0
        self.slow_holds_total = 0

    def record_wait(self, wait_ms: float, *, slow: bool = False, timed_out: bool = False) -> None:
        clamped = max(0.0, float(wait_ms))
        with self._lock:
            self._wait_ms.append(clamped)
            if timed_out:
                self.wait_timeouts_total += 1
            else:
                self.checkouts_total += 1
            if slow:
                self.slow_waits_total += 1

    def record_hold(self, hold_ms: float, *, slow: bool = False) -> None:
        clamped = max(0.0, float(hold_ms))
        with self._lock:
            self._hold_ms.append(clamped)
            if slow:
                self.slow_holds_total += 1

    def snapshot(self) -> dict[str, object]:
        with self._lock:
            wait_summary = _summarize_window(self._wait_ms)
            hold_summary = _summarize_window(self._hold_ms)
            checkouts_total = self.checkouts_total
            wait_timeouts_total = self.wait_timeouts_total
            slow_waits_total = self.slow_waits_total
            slow_holds_total = self.slow_holds_total
        return {
            "pool_type": type(self._pool).__name__,
            "pool_size": self._pool.size(),
            "checked_out": self._pool.checkedout(),
            "overflow": max(0, self._pool.overflow()),
            "checkouts_total": checkouts_total,
            "wait_timeouts_total": wait_timeouts_total,
            "slow_waits_total": slow_waits_total,
            "slow_holds_total": slow_holds_total,
            "wait_ms": wait_summary,
            "hold_ms": hold_summary,
        }


def get_pool_metrics_snapshot(target_engine) -> dict[str, object]:
    """Return bounded, PII-free pool telemetry suitable for /health and ops diagnostics."""
    pool = getattr(target_engine, "pool", None)
    if not isinstance(pool, QueuePool):
        return {
            "pool_type": type(pool).__name__ if pool is not None else "unknown",
        }
    telemetry = getattr(pool, _TELEMETRY_ATTR, None)
    if isinstance(telemetry, PoolTelemetry):
        return telemetry.snapshot()
    return {
        "pool_type": type(pool).__name__,
        "pool_size": pool.size(),
        "checked_out": pool.checkedout(),
        "overflow": max(0, pool.overflow()),
    }


def install_pool_diagnostics(
    engine,
    tenant_id,
    *,
    slow_seconds: float = 5.0,
    slow_wait_seconds: float = 0.5,
    window_size: int = _DEFAULT_WINDOW_SIZE,
) -> PoolTelemetry | None:
    if not isinstance(engine.pool, QueuePool):
        return None
    pool = engine.pool
    existing = getattr(pool, _TELEMETRY_ATTR, None)
    if isinstance(existing, PoolTelemetry):
        return existing

    telemetry = PoolTelemetry(pool, window_size=window_size)
    setattr(pool, _TELEMETRY_ATTR, telemetry)

    original_do_get = pool._do_get

    def _instrumented_do_get():
        wait_started = monotonic()
        try:
            conn = original_do_get()
        except SQLAlchemyTimeoutError:
            wait_duration = max(0.0, monotonic() - wait_started)
            wait_ms = round(wait_duration * 1000, 2)
            telemetry.record_wait(wait_ms, slow=True, timed_out=True)
            logger.warning(
                json.dumps(
                    {
                        "event": "sql_pool_timeout",
                        "wait_ms": wait_ms,
                        "restaurante_id": tenant_id(),
                        "origin": _resolve_checkout_origin(),
                        "pool_size": pool.size(),
                        "checked_out": pool.checkedout(),
                        "overflow": max(0, pool.overflow()),
                    },
                    separators=(",", ":"),
                )
            )
            raise
        wait_duration = max(0.0, monotonic() - wait_started)
        wait_ms = round(wait_duration * 1000, 2)
        is_slow_wait = wait_duration >= slow_wait_seconds
        telemetry.record_wait(wait_ms, slow=is_slow_wait, timed_out=False)
        if is_slow_wait:
            logger.warning(
                json.dumps(
                    {
                        "event": "sql_pool_wait_slow",
                        "wait_ms": wait_ms,
                        "restaurante_id": tenant_id(),
                        "origin": _resolve_checkout_origin(),
                        "pool_size": pool.size(),
                        "checked_out": pool.checkedout(),
                        "overflow": max(0, pool.overflow()),
                    },
                    separators=(",", ":"),
                )
            )
        return conn

    pool._do_get = _instrumented_do_get

    @event.listens_for(pool, "checkout")
    def checkout(connection, record, proxy):
        record.info[_KEY] = (monotonic(), tenant_id(), _resolve_checkout_origin())

    @event.listens_for(pool, "checkin")
    def checkin(connection, record):
        metadata = record.info.pop(_KEY, None)
        if metadata is None:
            return
        started, restaurant, origin = metadata
        duration = max(0.0, monotonic() - started)
        duration_ms = round(duration * 1000, 2)
        is_slow_hold = duration >= slow_seconds
        telemetry.record_hold(duration_ms, slow=is_slow_hold)
        if is_slow_hold:
            logger.warning(
                json.dumps(
                    {
                        "event": "sql_connection_held",
                        "duration_ms": duration_ms,
                        "restaurante_id": restaurant,
                        "origin": origin,
                        "pool_size": pool.size(),
                        # checkin fires before the slot is returned to the queue.
                        "checked_out_before_return": pool.checkedout(),
                        "overflow": max(0, pool.overflow()),
                    },
                    separators=(",", ":"),
                )
            )

    return telemetry
