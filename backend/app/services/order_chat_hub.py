"""Commit-safe realtime transport for order chat and tracking.

PostgreSQL remains the source of truth. Realtime is only a wake-up hint emitted
inside the same database transaction and becomes visible to listeners after the
outer commit. PostgreSQL LISTEN/NOTIFY fans the hint across app instances; local
SQLite tests publish only from SQLAlchemy's after_commit hook.
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
_PENDING_EVENTS_KEY = "order_chat_pending_events"
_EVENT_KEYS_KEY = "order_chat_pending_event_keys"
_SAVEPOINTS_KEY = "order_chat_pending_savepoints"


class OrderChatHub:
    """Fans durable order/chat wake-up hints out to connected SSE streams."""

    def __init__(self, *, listen_to_postgres: bool = True) -> None:
        self._listen_to_postgres = listen_to_postgres
        self._lock = threading.Lock()
        # conversation_id -> {subscription_id: (event_loop, queue)}
        self._conversation_subscribers: dict[
            str,
            dict[str, tuple[asyncio.AbstractEventLoop, asyncio.Queue]],
        ] = {}
        # restaurante_id -> {subscription_id: (event_loop, queue)}
        self._caixa_subscribers: dict[
            int,
            dict[str, tuple[asyncio.AbstractEventLoop, asyncio.Queue]],
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

    def subscribe_conversation(self, conversation_id: str) -> tuple[str, asyncio.Queue]:
        self.ensure_started()
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue = asyncio.Queue(maxsize=100)
        sub_id = str(uuid.uuid4())
        with self._lock:
            self._conversation_subscribers.setdefault(str(conversation_id), {})[sub_id] = (
                loop,
                queue,
            )
        return sub_id, queue

    def unsubscribe_conversation(self, conversation_id: str, sub_id: str) -> None:
        with self._lock:
            subscribers = self._conversation_subscribers.get(str(conversation_id))
            if not subscribers:
                return
            subscribers.pop(sub_id, None)
            if not subscribers:
                self._conversation_subscribers.pop(str(conversation_id), None)

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

    def _broadcast(
        self,
        targets: list[tuple[asyncio.AbstractEventLoop, asyncio.Queue]],
        *,
        event_type: str,
        data: dict[str, Any],
    ) -> None:
        payload = {"event": event_type, "data": data}
        for loop, queue in targets:
            try:
                loop.call_soon_threadsafe(self._enqueue_latest, queue, payload)
            except RuntimeError:
                # Request loop already closed; route cleanup will unsubscribe it.
                continue

    def publish_event(
        self,
        restaurante_id: int,
        conversation_id: str,
        event_type: str,
        data: dict[str, Any],
    ) -> None:
        """Fan out a hint that is already known to be commit-safe."""

        conversation_id = str(conversation_id)
        restaurante_id = int(restaurante_id)
        enriched = {
            **data,
            "conversation_id": conversation_id,
        }
        with self._lock:
            conversation_targets = list(
                self._conversation_subscribers.get(conversation_id, {}).values()
            )
            cashier_targets = list(
                self._caixa_subscribers.get(restaurante_id, {}).values()
            )

        self._broadcast(
            conversation_targets,
            event_type=event_type,
            data=enriched,
        )
        cashier_event = {
            "message": "new_message",
            "status": "status_changed",
        }.get(event_type, event_type)
        self._broadcast(
            cashier_targets,
            event_type=cashier_event,
            data=enriched,
        )

    # Backward-compatible helpers for tests and callers that already hold a
    # durable event. Production writers should use enqueue_order_chat_event().
    def publish_message(
        self,
        restaurante_id: int,
        conversation_id: str,
        message_data: dict[str, Any],
    ) -> None:
        self.publish_event(restaurante_id, conversation_id, "message", message_data)

    def publish_status(
        self,
        restaurante_id: int,
        conversation_id: str,
        status_data: dict[str, Any],
    ) -> None:
        self.publish_event(restaurante_id, conversation_id, "status", status_data)

    def publish_read(
        self,
        restaurante_id: int,
        conversation_id: str,
        read_data: dict[str, Any],
    ) -> None:
        self.publish_event(restaurante_id, conversation_id, "read_update", read_data)

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
                            payload = json.loads(notification.payload)
                            restaurante_id = int(payload["restaurante_id"])
                            conversation_id = str(payload["conversation_id"])
                            event_type = str(payload["event"])
                            data = payload.get("data") or {}
                            if not isinstance(data, dict):
                                raise ValueError("invalid data")
                        except (KeyError, TypeError, ValueError, json.JSONDecodeError):
                            logger.warning(
                                "[ORDER CHAT] Payload PostgreSQL inválido ignorado."
                            )
                            continue
                        if restaurante_id <= 0 or not conversation_id:
                            continue
                        self.publish_event(
                            restaurante_id,
                            conversation_id,
                            event_type,
                            data,
                        )
            except Exception as exc:
                self._listener_ready.clear()
                if not self._stop.is_set():
                    logger.warning(
                        "[ORDER CHAT] LISTEN indisponível; clientes usarão reconciliação/polling: %s",
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


def enqueue_order_chat_event(
    db: Session,
    *,
    restaurante_id: int,
    conversation_id: str,
    event_type: str,
    data: dict[str, Any] | None = None,
    dedupe_key: str | None = None,
) -> None:
    """Queue a small realtime hint tied to the current database transaction.

    PostgreSQL's pg_notify is transactional: listeners receive it only after the
    outer commit and never after rollback. SQLite/local tests keep the hint in
    Session.info and fan it out from after_commit.
    """

    normalized_restaurante_id = int(restaurante_id)
    normalized_conversation_id = str(conversation_id)
    normalized_event_type = str(event_type)
    if dedupe_key:
        event_key = (
            normalized_restaurante_id,
            normalized_conversation_id,
            normalized_event_type,
            str(dedupe_key),
        )
        queued_keys = db.info.setdefault(_EVENT_KEYS_KEY, set())
        if event_key in queued_keys:
            return
        queued_keys.add(event_key)

    payload = {
        "restaurante_id": normalized_restaurante_id,
        "conversation_id": normalized_conversation_id,
        "event": normalized_event_type,
        "data": dict(data or {}),
    }
    encoded = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    if len(encoded.encode("utf-8")) >= 7500:
        raise ValueError("order chat realtime payload exceeds safe NOTIFY size")

    if db.get_bind().dialect.name == "postgresql":
        db.execute(
            text("SELECT pg_notify(:channel, :payload)"),
            {"channel": ORDER_CHAT_CHANNEL, "payload": encoded},
        )
        return

    db.info.setdefault(_PENDING_EVENTS_KEY, []).append(payload)


@event.listens_for(Session, "after_commit")
def _publish_local_order_chat_events(session: Session) -> None:
    if session.in_nested_transaction():
        return
    pending = session.info.pop(_PENDING_EVENTS_KEY, [])
    for payload in pending:
        order_chat_hub.publish_event(
            int(payload["restaurante_id"]),
            str(payload["conversation_id"]),
            str(payload["event"]),
            dict(payload.get("data") or {}),
        )


@event.listens_for(Session, "after_rollback")
def _discard_order_chat_events_on_rollback(session: Session) -> None:
    nested = session.get_nested_transaction()
    snapshots = session.info.get(_SAVEPOINTS_KEY, {})
    if nested in snapshots:
        snapshot = snapshots[nested]
        session.info[_PENDING_EVENTS_KEY] = list(snapshot["events"])
        session.info[_EVENT_KEYS_KEY] = set(snapshot["keys"])
        return
    session.info.pop(_PENDING_EVENTS_KEY, None)
    session.info.pop(_EVENT_KEYS_KEY, None)


@event.listens_for(Session, "after_transaction_create")
def _snapshot_order_chat_savepoint(session: Session, transaction) -> None:
    if not transaction.nested:
        return
    session.info.setdefault(_SAVEPOINTS_KEY, {})[transaction] = {
        "events": list(session.info.get(_PENDING_EVENTS_KEY, [])),
        "keys": set(session.info.get(_EVENT_KEYS_KEY, set())),
    }


@event.listens_for(Session, "after_transaction_end")
def _cleanup_order_chat_transaction(session: Session, transaction) -> None:
    session.info.get(_SAVEPOINTS_KEY, {}).pop(transaction, None)
    if transaction.parent is None:
        session.info.pop(_PENDING_EVENTS_KEY, None)
        session.info.pop(_EVENT_KEYS_KEY, None)
        session.info.pop(_SAVEPOINTS_KEY, None)
