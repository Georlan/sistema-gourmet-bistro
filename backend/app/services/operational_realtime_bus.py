"""Best-effort cross-process hints for operational WebSockets.

PostgreSQL remains authoritative. LISTEN/NOTIFY carries refresh hints only;
clients reconcile through HTTP after reconnect. All realtime channels share one
multiplexed PostgreSQL LISTEN connection per process.
"""

from __future__ import annotations

import json
import logging
import uuid
from collections.abc import Callable

from sqlalchemy import text

from ..database import engine
from .postgres_listen_multiplexer import PostgresListenMultiplexer, listen_multiplexer

logger = logging.getLogger(__name__)
CHANNEL = "koma_operational_realtime"


class OperationalRealtimeBus:
    def __init__(
        self,
        deliver: Callable[[dict], None],
        *,
        multiplexer: PostgresListenMultiplexer | None = None,
    ) -> None:
        self.deliver = deliver
        self.instance_id = uuid.uuid4().hex
        self._multiplexer = multiplexer or listen_multiplexer
        self.ready = self._multiplexer.ready

    @property
    def generation(self) -> int:
        return self._multiplexer.generation

    def _handle_notify(self, payload: str) -> None:
        try:
            envelope = json.loads(payload)
            if isinstance(envelope, dict):
                self.deliver(envelope)
        except (TypeError, ValueError):
            logger.warning("Invalid operational realtime notification ignored")

    def start(self) -> None:
        self._multiplexer.register_handler(CHANNEL, self._handle_notify)
        self._multiplexer.set_application_name(f"koma-operational-{self.instance_id[:8]}")
        if engine.dialect.name != "postgresql":
            self.ready.set()
            return
        self._multiplexer.start()

    def stop(self) -> None:
        self._multiplexer.stop()

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
