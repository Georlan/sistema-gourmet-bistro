"""Best-effort cross-process hints for operational WebSockets.

PostgreSQL remains authoritative. LISTEN/NOTIFY carries refresh hints only;
clients reconcile through HTTP after reconnect. The listener owns one separate
connection per process and reconnects after an interruption.
"""

from __future__ import annotations

import json
import logging
import select
import threading
import uuid
import contextlib
from collections.abc import Callable

from sqlalchemy import text

from ..config import settings
from ..database import engine

logger = logging.getLogger(__name__)
CHANNEL = "koma_operational_realtime"


class OperationalRealtimeBus:
    def __init__(self, deliver: Callable[[dict], None]) -> None:
        self.deliver = deliver
        self.instance_id = uuid.uuid4().hex
        self.generation = 0
        self.ready = threading.Event()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()

    def start(self) -> None:
        if engine.dialect.name != "postgresql":
            self.ready.set()
            return
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return
            self._stop.clear()
            self._thread = threading.Thread(target=self._listen_forever, name="koma-operational-realtime", daemon=True)
            self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=12)
        self.ready.clear()

    def publish(self, envelope: dict) -> None:
        if engine.dialect.name != "postgresql":
            return
        payload = json.dumps(envelope, separators=(",", ":"), ensure_ascii=False)
        if len(payload.encode()) > 7500:
            raise ValueError("Operational realtime hint exceeds PostgreSQL NOTIFY limit")
        with engine.begin() as connection:
            connection.execute(text("SELECT pg_notify(:channel, :payload)"), {"channel": CHANNEL, "payload": payload})

    def queue_committed(self, db, envelope: dict) -> None:
        """Queue in the caller's transaction; PostgreSQL delivers after commit."""
        if db.get_bind().dialect.name == "postgresql":
            payload = json.dumps(envelope, separators=(",", ":"), ensure_ascii=False)
            if len(payload.encode()) > 7500:
                raise ValueError("Operational realtime hint exceeds PostgreSQL NOTIFY limit")
            db.execute(text("SELECT pg_notify(:channel, :payload)"), {"channel": CHANNEL, "payload": payload})
        else:
            db.info.setdefault("operational_realtime_after_commit", []).append(envelope)

    def _listen_forever(self) -> None:
        import psycopg2

        dsn = settings.DATABASE_URL.replace("postgresql+psycopg2://", "postgresql://", 1)
        while not self._stop.is_set():
            connection = None
            cursor = None
            try:
                connection = psycopg2.connect(
                    dsn, connect_timeout=10,
                    application_name=f"koma-operational-{self.instance_id[:8]}",
                )
                connection.autocommit = True
                cursor = connection.cursor()
                cursor.execute(f'LISTEN "{CHANNEL}"')
                self.generation += 1
                self.ready.set()
                while not self._stop.is_set():
                    readable, _, _ = select.select([connection], [], [], 0.5)
                    if not readable:
                        continue
                    connection.poll()
                    while connection.notifies:
                        notification = connection.notifies.pop(0)
                        try:
                            envelope = json.loads(notification.payload)
                            if isinstance(envelope, dict):
                                self.deliver(envelope)
                        except (TypeError, ValueError):
                            logger.warning("Invalid operational realtime notification ignored")
            except Exception as exc:
                self.ready.clear()
                if not self._stop.is_set():
                    logger.warning("Operational realtime listener reconnecting: %s", type(exc).__name__)
                    self._stop.wait(2)
            finally:
                self.ready.clear()
                if cursor is not None:
                    with contextlib.suppress(Exception):
                        cursor.close()
                if connection is not None:
                    with contextlib.suppress(Exception):
                        connection.close()
