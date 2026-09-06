"""Universal print wake-up transport and end-to-end queue observability.

PrintJob remains the durable source of truth. This module only emits a wake-up
hint after the database transaction is durable, so losing the hint can delay a
claim but can never lose or duplicate a ticket.
"""

from __future__ import annotations

import asyncio
import json
import logging
import select
import threading
import time
from time import perf_counter
from typing import Any

from sqlalchemy import event, inspect
from sqlalchemy.orm import Session

from ..config import settings
from ..database import engine
from ..models import PrintJob


log = logging.getLogger("koma.print_delivery")
PRINT_WAKEUP_CHANNEL = "koma_print_jobs"
_PIPELINE_JOBS_KEY = "print_pipeline_jobs"
_PIPELINE_TENANTS_KEY = "print_wakeup_tenants"
_PIPELINE_STARTED_KEY = "print_pipeline_tx_started_at"
_PIPELINE_SAVEPOINTS_KEY = "print_pipeline_savepoints"


class PrintWakeupHub:
    """Fans PostgreSQL NOTIFY hints out to connected agent SSE streams."""

    def __init__(self, *, listen_to_postgres: bool = True) -> None:
        self._listen_to_postgres = listen_to_postgres
        self._lock = threading.Lock()
        self._subscribers: dict[int, dict[int, tuple[asyncio.AbstractEventLoop, asyncio.Queue]]] = {}
        self._stop = threading.Event()
        self._listener_ready = threading.Event()
        self._listener_thread: threading.Thread | None = None

    def ensure_started(self) -> None:
        if engine.dialect.name != "postgresql" or not self._listen_to_postgres:
            self._listener_ready.set()
            return
        with self._lock:
            if self._listener_thread is not None and self._listener_thread.is_alive():
                return
            self._stop.clear()
            self._listener_thread = threading.Thread(
                target=self._listen_forever,
                name="koma-print-wakeup",
                daemon=True,
            )
            self._listener_thread.start()

    def stop(self) -> None:
        self._stop.set()
        thread = self._listener_thread
        if thread is not None and thread.is_alive():
            thread.join(timeout=2.0)
        self._listener_ready.clear()

    def transport_status(self) -> dict[str, Any]:
        if engine.dialect.name == "postgresql" and self._listen_to_postgres:
            return {
                "push_available": self._listener_ready.is_set(),
                "transport": "postgres-notify-sse-v1",
            }
        return {
            "push_available": True,
            "transport": "local-commit-sse-v1",
        }

    def subscribe(self, restaurante_id: int) -> tuple[int, asyncio.Queue]:
        self.ensure_started()
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue = asyncio.Queue(maxsize=8)
        subscription_id = id(queue)
        with self._lock:
            self._subscribers.setdefault(int(restaurante_id), {})[subscription_id] = (
                loop,
                queue,
            )
        return subscription_id, queue

    def unsubscribe(self, restaurante_id: int, subscription_id: int) -> None:
        with self._lock:
            tenant_subscribers = self._subscribers.get(int(restaurante_id))
            if not tenant_subscribers:
                return
            tenant_subscribers.pop(subscription_id, None)
            if not tenant_subscribers:
                self._subscribers.pop(int(restaurante_id), None)

    def publish(self, restaurante_id: int, *, reason: str) -> None:
        payload = {
            "restaurante_id": int(restaurante_id),
            "reason": reason,
            "emitted_at_monotonic": time.monotonic(),
        }
        with self._lock:
            targets = list(self._subscribers.get(int(restaurante_id), {}).values())
        for loop, queue in targets:
            try:
                loop.call_soon_threadsafe(self._enqueue_latest, queue, payload)
            except RuntimeError:
                # The request loop already closed; unsubscribe cleanup follows.
                continue

    @staticmethod
    def _enqueue_latest(queue: asyncio.Queue, payload: dict[str, Any]) -> None:
        if queue.full():
            try:
                queue.get_nowait()
            except asyncio.QueueEmpty:
                pass
        try:
            queue.put_nowait(payload)
        except asyncio.QueueFull:
            pass

    @staticmethod
    def _postgres_dsn() -> str:
        dsn = settings.DATABASE_URL
        if dsn.startswith("postgresql+psycopg2://"):
            dsn = "postgresql://" + dsn.split("://", 1)[1]
        elif dsn.startswith("postgres://"):
            dsn = "postgresql://" + dsn.split("://", 1)[1]
        return dsn

    def _listen_forever(self) -> None:
        import psycopg2

        while not self._stop.is_set():
            connection = None
            cursor = None
            try:
                connection = psycopg2.connect(
                    self._postgres_dsn(),
                    connect_timeout=10,
                    application_name="koma-print-wakeup",
                )
                connection.autocommit = True
                cursor = connection.cursor()
                cursor.execute(f'LISTEN "{PRINT_WAKEUP_CHANNEL}"')
                self._listener_ready.set()
                log.info("[PRINT WAKEUP] PostgreSQL LISTEN ativo.")

                while not self._stop.is_set():
                    readable, _, _ = select.select([connection], [], [], 5.0)
                    if not readable:
                        continue
                    connection.poll()
                    while connection.notifies:
                        notification = connection.notifies.pop(0)
                        try:
                            restaurante_id = int(notification.payload)
                        except (TypeError, ValueError):
                            log.warning(
                                "[PRINT WAKEUP] Payload PostgreSQL inválido ignorado."
                            )
                            continue
                        if restaurante_id > 0:
                            self.publish(restaurante_id, reason="postgres-notify")
            except Exception as exc:
                self._listener_ready.clear()
                if not self._stop.is_set():
                    log.warning(
                        "[PRINT WAKEUP] LISTEN indisponível; agentes usarão polling: %s",
                        exc,
                    )
                    self._stop.wait(2.0)
            finally:
                self._listener_ready.clear()
                if cursor is not None:
                    try:
                        cursor.close()
                    except Exception:
                        pass
                if connection is not None:
                    try:
                        connection.close()
                    except Exception:
                        pass


print_wakeup_hub = PrintWakeupHub()


def _clear_pipeline_state(session: Session) -> None:
    session.info.pop(_PIPELINE_JOBS_KEY, None)
    session.info.pop(_PIPELINE_TENANTS_KEY, None)
    session.info.pop(_PIPELINE_STARTED_KEY, None)


@event.listens_for(Session, "after_begin")
def _start_print_pipeline_timer(session: Session, transaction, connection) -> None:
    if transaction.nested:
        return
    session.info.setdefault(_PIPELINE_STARTED_KEY, perf_counter())


@event.listens_for(Session, "after_flush")
def _capture_print_jobs(session: Session, flush_context) -> None:
    started_at = session.info.get(_PIPELINE_STARTED_KEY)
    jobs = session.info.setdefault(_PIPELINE_JOBS_KEY, [])
    known_job_ids = {item.get("job_id") for item in jobs}
    wake_tenants = session.info.setdefault(_PIPELINE_TENANTS_KEY, set())

    for job in session.new:
        if not isinstance(job, PrintJob):
            continue
        restaurante_id = getattr(job, "restaurante_id", None)
        if isinstance(restaurante_id, int) and restaurante_id > 0:
            wake_tenants.add(restaurante_id)
        if job.id in known_job_ids:
            continue
        jobs.append(
            {
                "job_id": job.id,
                "restaurante_id": restaurante_id,
                "document_type": job.document_type,
                "source_type": job.source_type,
                "destination": job.destination,
                "transaction_to_job_ms": (
                    round((perf_counter() - started_at) * 1000, 2)
                    if started_at is not None
                    else None
                ),
            }
        )
        known_job_ids.add(job.id)

    # Retries/releases can make an existing row pending again. PostgreSQL has a
    # trigger for this transition; SQLite/local mode uses this commit hook.
    for job in session.dirty:
        if not isinstance(job, PrintJob) or job.status != "pending":
            continue
        history = inspect(job).attrs.status.history
        if not history.has_changes():
            continue
        restaurante_id = getattr(job, "restaurante_id", None)
        if isinstance(restaurante_id, int) and restaurante_id > 0:
            wake_tenants.add(restaurante_id)


@event.listens_for(Session, "after_commit")
def _after_print_pipeline_commit(session: Session) -> None:
    if session.in_nested_transaction():
        return

    jobs = session.info.pop(_PIPELINE_JOBS_KEY, [])
    wake_tenants = session.info.pop(_PIPELINE_TENANTS_KEY, set())
    started_at = session.info.pop(_PIPELINE_STARTED_KEY, None)
    if jobs:
        log.info(
            json.dumps(
                {
                    "event": "print_pipeline_commit",
                    "transaction_to_commit_ms": (
                        round((perf_counter() - started_at) * 1000, 2)
                        if started_at is not None
                        else None
                    ),
                    "job_count": len(jobs),
                    "jobs": jobs,
                },
                separators=(",", ":"),
            )
        )

    # PostgreSQL emits a transactional NOTIFY from the database trigger. Local
    # SQLite has no trigger, so publish only after the outer commit is durable.
    if engine.dialect.name != "postgresql":
        for restaurante_id in wake_tenants:
            print_wakeup_hub.publish(restaurante_id, reason="local-commit")


@event.listens_for(Session, "after_rollback")
def _discard_print_pipeline_on_rollback(session: Session) -> None:
    nested = session.get_nested_transaction()
    snapshots = session.info.get(_PIPELINE_SAVEPOINTS_KEY, {})
    if nested in snapshots:
        jobs, tenants, started_at = snapshots[nested]
        session.info[_PIPELINE_JOBS_KEY] = list(jobs)
        session.info[_PIPELINE_TENANTS_KEY] = set(tenants)
        session.info[_PIPELINE_STARTED_KEY] = started_at
        return
    _clear_pipeline_state(session)


@event.listens_for(Session, "after_transaction_create")
def _snapshot_print_pipeline_savepoint(session: Session, transaction) -> None:
    if not transaction.nested:
        return
    session.info.setdefault(_PIPELINE_SAVEPOINTS_KEY, {})[transaction] = (
        list(session.info.get(_PIPELINE_JOBS_KEY, [])),
        set(session.info.get(_PIPELINE_TENANTS_KEY, set())),
        session.info.get(_PIPELINE_STARTED_KEY),
    )


@event.listens_for(Session, "after_transaction_end")
def _cleanup_print_pipeline_transaction(session: Session, transaction) -> None:
    session.info.get(_PIPELINE_SAVEPOINTS_KEY, {}).pop(transaction, None)
    if transaction.parent is None:
        _clear_pipeline_state(session)
        session.info.pop(_PIPELINE_SAVEPOINTS_KEY, None)
