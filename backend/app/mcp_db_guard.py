"""Pool protection, bounded caching, and read-only transaction guardrails for engineering MCP DB tools."""

from __future__ import annotations

import asyncio
from collections import OrderedDict
from collections.abc import Callable
import threading
import time
from typing import Any, TypeVar
from weakref import WeakKeyDictionary

import anyio
from sqlalchemy import text
from sqlalchemy.orm import Session

from .database import SessionLocal

T = TypeVar("T")

DEFAULT_CONCURRENCY_LIMIT = 1
DEFAULT_WAIT_TIMEOUT_SECONDS = 0.5
DEFAULT_TOTAL_TIMEOUT_SECONDS = 3.0
DEFAULT_STATEMENT_TIMEOUT_MS = 2000
DEFAULT_CACHE_TTL_SECONDS = 20.0
DEFAULT_CACHE_MAX_ENTRIES = 16
MAX_RESPONSE_BYTES = 65_536

_SEMAPHORES: WeakKeyDictionary[object, anyio.Semaphore] = WeakKeyDictionary()
_FALLBACK_SEMAPHORE: anyio.Semaphore | None = None
_SEMAPHORE_LOCK = threading.Lock()
_CACHE_LOCK = threading.Lock()
_RESULT_CACHE: OrderedDict[str, tuple[float, Any]] = OrderedDict()


class MCPBusyError(RuntimeError):
    """Raised when the MCP database slot is already occupied beyond fail-fast wait budget."""


class MCPQueryTimeoutError(TimeoutError):
    """Raised when a protected MCP database read exceeds the allowed time budget."""


def _current_loop_semaphore() -> anyio.Semaphore:
    global _FALLBACK_SEMAPHORE
    try:
        loop: object = asyncio.get_running_loop()
    except RuntimeError:
        loop = None
    with _SEMAPHORE_LOCK:
        if loop is None:
            if _FALLBACK_SEMAPHORE is None:
                _FALLBACK_SEMAPHORE = anyio.Semaphore(DEFAULT_CONCURRENCY_LIMIT)
            return _FALLBACK_SEMAPHORE
        sem = _SEMAPHORES.get(loop)
        if sem is None:
            sem = anyio.Semaphore(DEFAULT_CONCURRENCY_LIMIT)
            _SEMAPHORES[loop] = sem
        return sem


def clear_mcp_cache() -> None:
    """Clear the bounded in-memory MCP read cache (primarily for deterministic tests)."""
    with _CACHE_LOCK:
        _RESULT_CACHE.clear()


def _get_cached_result(cache_key: str) -> Any | None:
    now = time.monotonic()
    with _CACHE_LOCK:
        entry = _RESULT_CACHE.get(cache_key)
        if entry is None:
            return None
        expires_at, payload = entry
        if now >= expires_at:
            _RESULT_CACHE.pop(cache_key, None)
            return None
        _RESULT_CACHE.move_to_end(cache_key)
        return payload


def _store_cached_result(cache_key: str, payload: Any, ttl_seconds: float) -> None:
    if ttl_seconds <= 0:
        return
    expires_at = time.monotonic() + ttl_seconds
    with _CACHE_LOCK:
        _RESULT_CACHE[cache_key] = (expires_at, payload)
        _RESULT_CACHE.move_to_end(cache_key)
        while len(_RESULT_CACHE) > DEFAULT_CACHE_MAX_ENTRIES:
            _RESULT_CACHE.popitem(last=False)


def configure_readonly_tx(db: Session, *, statement_timeout_ms: int = DEFAULT_STATEMENT_TIMEOUT_MS) -> None:
    """Enforce read-only transaction and statement timeout on PostgreSQL sessions."""
    bind = db.get_bind()
    if bind is None or bind.dialect.name != "postgresql":
        return
    timeout_ms = max(100, int(statement_timeout_ms))
    db.execute(text("SET LOCAL TRANSACTION READ ONLY"))
    db.execute(text("SET LOCAL statement_timeout = :ms"), {"ms": str(timeout_ms)})


async def run_protected_db_read(
    cache_key: str,
    query_fn: Callable[[Session], T],
    *,
    ttl_seconds: float = DEFAULT_CACHE_TTL_SECONDS,
    wait_timeout_seconds: float = DEFAULT_WAIT_TIMEOUT_SECONDS,
    total_timeout_seconds: float = DEFAULT_TOTAL_TIMEOUT_SECONDS,
    statement_timeout_ms: int = DEFAULT_STATEMENT_TIMEOUT_MS,
    session_factory: Callable[[], Session] = SessionLocal,
) -> T:
    """Execute a bounded, fail-fast, read-only DB query preserving the main operational pool."""
    cached = _get_cached_result(cache_key)
    if cached is not None:
        return cached

    sem = _current_loop_semaphore()
    try:
        with anyio.fail_after(wait_timeout_seconds):
            await sem.acquire()
    except TimeoutError as exc:
        raise MCPBusyError("MCP database read slot is busy; try again shortly.") from exc

    def _run_sync() -> T:
        db = session_factory()
        try:
            configure_readonly_tx(db, statement_timeout_ms=statement_timeout_ms)
            return query_fn(db)
        finally:
            try:
                if db.in_transaction():
                    db.rollback()
            finally:
                db.close()

    try:
        started_at = time.monotonic()
        with anyio.move_on_after(total_timeout_seconds) as timeout_scope:
            # abandon_on_cancel=False keeps the semaphore held until the worker thread
            # finishes its rollback/close and returns the connection to QueuePool.
            result = await anyio.to_thread.run_sync(
                _run_sync,
                abandon_on_cancel=False,
            )
        if timeout_scope.cancel_called or (time.monotonic() - started_at) > total_timeout_seconds:
            raise MCPQueryTimeoutError("MCP database read exceeded total timeout budget.")
    finally:
        sem.release()

    _store_cached_result(cache_key, result, ttl_seconds)
    return result
