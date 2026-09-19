"""Commit-safe realtime transport for order chat and tracking.

PostgreSQL is the authority for cross-process wake-ups. Events are queued inside
the same transaction with pg_notify(), so PostgreSQL only delivers them after a
successful commit. SQLite/test mode mirrors that contract with an after_commit
hook. SSE remains a delivery hint; HTTP snapshots stay authoritative.
"""

from __future__ import annotations

import asyncio
import json
import logging
import select
import threading
import uuid
from typing import Any

from sqlalchemy import event, text
from sqlalchemy.orm import Session

from ..config import settings
from ..database import engine

logger = logging.getLogger(__name__)

ORDER_CHAT_CHANNEL = "koma_order_chat"
_LOCAL_PENDING_KEY = "order_chat_pending_realtime"
_ALLOWED_KINDS = frozenset({"message", "status", "read"})


class OrderChatHub:
    """Fan-out from one PostgreSQL LISTEN connection to local SSE subscribers."""

    def __init__(self, *, listen_to_postgres: bool = True) -> None:
        self._listen_to_postgres = listen_to_postgres
        self._lock = threading.Lock()
        # conversation_id -> {sub_id: (event_loop, queue)}
        self._conversation_subscribers: dict[
            str, dict[str, tuple[asyncio.AbstractEventLoop, asyncio.Queue]]
        ] = {}
        # restaurante_id -> {sub_id: (event_loop, queue)}
        self._caixa_subscribers: dict[
            int, dict[str, tuple[asyncio.AbstractEventLoop, asyncio.Queue]]
        ] = {}
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
                name="koma-order-chat-realtime",
                daemon=True,
            )
            self._listener_thread.start()

    def stop(self) -> None:
        self._stop.set()
        thread = self._listener_thread
        if thread is not None and thread.is_alive():
            thread.join(timeout=2.0)
        self._listener_ready.clear()

    def subscribe_conversation(self, conversation_id: str) -> tuple[str, asyncio.Queue]:
        self.ensure_started()
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue = asyncio.Queue(maxsize=100)
        sub_id = str(uuid.uuid4())
        with self._lock:
            self._conversation_subscribers.setdefault(conversation_id, {})[sub_id] = (
                loop,
                queue,
            )
        return sub_id, queue

    def unsubscribe_conversation(self, conversation_id: str, sub_id: str) -> None:
        with self._lock:
            subscribers = self._conversation_subscribers.get(conversation_id)
            if not subscribers:
                return
            subscribers.pop(sub_id, None)
            if not subscribers:
                self._conversation_subscribers.pop(conversation_id, None)

    def subscribe_caixa(self, restaurante_id: int) -> tuple[str, asyncio.Queue]:
        self.ensure_started()
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue = asyncio.Queue(maxsize=100)
        sub_id = str(uuid.uuid4())
        with self._lock:
            self._caixa_subscribers.setdefault(int(restaurante_id), {})[sub_id] = (
                loop,
                queue,
            )
        return sub_id, queue

    def unsubscribe_caixa(self, restaurante_id: int, sub_id: str) -> None:
        with self._lock:
            subscribers = self._caixa_subscribers.get(int(restaurante_id))
            if not subscribers:
                return
            subscribers.pop(sub_id, None)
            if not subscribers:
                self._caixa_subscribers.pop(int(restaurante_id), None)

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

    def _fan_out(
        self,
        targets: list[tuple[asyncio.AbstractEventLoop, asyncio.Queue]],
        payload: dict[str, Any],
    ) -> None:
        for loop, queue in targets:
            try:
                loop.call_soon_threadsafe(self._enqueue_latest, queue, payload)
            except RuntimeError:
                # The request loop already closed; route cleanup removes it.
                continue

    def broadcast_to_conversation(
        self,
        conversation_id: str,
        event_type: str,
        data: dict[str, Any],
    ) -> None:
        with self._lock:
            targets = list(
                self._conversation_subscribers.get(conversation_id, {}).values()
            )
        self._fan_out(targets, {"event": event_type, "data": data})

    def broadcast_to_caixa(
        self,
        restaurante_id: int,
        event_type: str,
        data: dict[str, Any],
    ) -> None:
        with self._lock:
            targets = list(
                self._caixa_subscribers.get(int(restaurante_id), {}).values()
            )
        self._fan_out(targets, {"event": event_type, "data": data})

    def publish_committed(self, envelope: dict[str, Any]) -> None:
        try:
            restaurante_id = int(envelope["restaurante_id"])
            conversation_id = str(envelope["conversation_id"])
            kind = str(envelope["kind"])
            data = dict(envelope.get("data") or {})
        except (KeyError, TypeError, ValueError):
            logger.warning("[ORDER CHAT] Evento realtime inválido ignorado.")
            return

        if restaurante_id <= 0 or not conversation_id or kind not in _ALLOWED_KINDS:
            logger.warning("[ORDER CHAT] Evento realtime fora do contrato ignorado.")
            return

        enriched = {**data, "conversation_id": conversation_id}
        if kind == "message":
            self.broadcast_to_conversation(conversation_id, "message", enriched)
            self.broadcast_to_caixa(restaurante_id, "new_message", enriched)
        elif kind == "status":
            self.broadcast_to_conversation(conversation_id, "status", enriched)
            self.broadcast_to_caixa(restaurante_id, "status_changed", enriched)
        else:
            self.broadcast_to_conversation(conversation_id, "read_update", enriched)
            self.broadcast_to_caixa(restaurante_id, "read_update", enriched)

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
                    application_name="koma-order-chat-realtime",
                )
                connection.autocommit = True
                cursor = connection.cursor()
                cursor.execute(f'LISTEN "{ORDER_CHAT_CHANNEL}"')
                self._listener_ready.set()
                logger.info("[ORDER CHAT] PostgreSQL LISTEN ativo.")

                while not self._stop.is_set():
                    readable, _, _ = select.select([connection], [], [], 5.0)
                    if not readable:
                        continue
                    connection.poll()
                    while connection.notifies:
                        notification = connection.notifies.pop(0)
                        try:
                            envelope = json.loads(notification.payload)
                        except (TypeError, ValueError):
                            logger.warning(
                                "[ORDER CHAT] Payload PostgreSQL inválido ignorado."
                            )
                            continue
                        if isinstance(envelope, dict):
                            self.publish_committed(envelope)
            except Exception as exc:
                self._listener_ready.clear()
                if not self._stop.is_set():
                    logger.warning(
                        "[ORDER CHAT] LISTEN indisponível; SSE dependerá da reconciliação HTTP: %s",
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


order_chat_hub = OrderChatHub()


def queue_order_chat_event(
    db: Session,
    *,
    restaurante_id: int,
    conversation_id: str,
    kind: str,
    data: dict[str, Any],
) -> None:
    """Queue a realtime hint that cannot escape before the outer commit."""

    if kind not in _ALLOWED_KINDS:
        raise ValueError(f"kind de realtime inválido: {kind}")
    envelope = {
        "restaurante_id": int(restaurante_id),
        "conversation_id": str(conversation_id),
        "kind": kind,
        "data": data,
    }
    payload = json.dumps(envelope, separators=(",", ":"), ensure_ascii=False)
    # PostgreSQL NOTIFY has an 8 KiB payload limit. Messages are capped at 1,000
    # chars, so 7 KiB leaves comfortable room for metadata and UTF-8 expansion.
    if len(payload.encode("utf-8")) > 7000:
        raise ValueError("Evento realtime do chat excedeu o limite seguro.")

    if db.get_bind().dialect.name == "postgresql":
        db.execute(
            text("SELECT pg_notify(:channel, :payload)"),
            {"channel": ORDER_CHAT_CHANNEL, "payload": payload},
        )
        return

    db.info.setdefault(_LOCAL_PENDING_KEY, []).append(envelope)


@event.listens_for(Session, "after_commit")
def _publish_local_chat_events_after_commit(session: Session) -> None:
    if session.in_nested_transaction():
        return
    pending = session.info.pop(_LOCAL_PENDING_KEY, [])
    if session.get_bind().dialect.name == "postgresql":
        return
    for envelope in pending:
        order_chat_hub.publish_committed(envelope)


@event.listens_for(Session, "after_rollback")
def _discard_local_chat_events_after_rollback(session: Session) -> None:
    if not session.in_nested_transaction():
        session.info.pop(_LOCAL_PENDING_KEY, None)


@event.listens_for(Session, "after_transaction_end")
def _cleanup_chat_realtime_state(session: Session, transaction) -> None:
    if transaction.parent is None:
        session.info.pop(_LOCAL_PENDING_KEY, None)
