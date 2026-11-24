"""Shared PostgreSQL LISTEN/NOTIFY multiplexer (1 session per backend process).

Maintains a single session-affine psycopg2 connection for the three realtime
channels (`koma_operational_realtime`, `koma_order_chat`, `koma_print_jobs`) so
that each process consumes 1 Supavisor Session Mode slot instead of 3.
"""

from __future__ import annotations

import contextlib
import logging
import select
import threading
from collections.abc import Callable

from ..config import settings

logger = logging.getLogger("koma.listen_multiplexer")

MULTIPLEXED_CHANNELS: tuple[str, ...] = (
    "koma_operational_realtime",
    "koma_order_chat",
    "koma_print_jobs",
)
_RECONNECT_BACKOFF_SECONDS: tuple[float, ...] = (1.0, 2.0, 4.0, 8.0, 15.0)


def normalize_postgres_dsn(dsn: str) -> str:
    if dsn.startswith("postgresql+psycopg2://"):
        return "postgresql://" + dsn.split("://", 1)[1]
    if dsn.startswith("postgres://"):
        return "postgresql://" + dsn.split("://", 1)[1]
    return dsn


class PostgresListenMultiplexer:
    """Owns one dedicated psycopg2 LISTEN connection shared across hubs."""

    def __init__(
        self,
        *,
        channels: tuple[str, ...] = MULTIPLEXED_CHANNELS,
        dsn_provider: Callable[[], str] | None = None,
        dialect_provider: Callable[[], str] | None = None,
        connect_fn: Callable[..., object] | None = None,
        select_fn: Callable[..., tuple] | None = None,
        backoff_schedule: tuple[float, ...] = _RECONNECT_BACKOFF_SECONDS,
    ) -> None:
        self._channels = tuple(dict.fromkeys(channels))
        self._dsn_provider = dsn_provider or (lambda: settings.DATABASE_URL)
        self._dialect_provider = dialect_provider
        self._connect_fn = connect_fn
        self._select_fn = select_fn or select.select
        self._backoff_schedule = backoff_schedule or (1.0,)

        self._lock = threading.Lock()
        self._handlers: dict[str, list[Callable[[str], None]]] = {}
        self._application_name = "koma-listen-multiplexer"
        self._stop = threading.Event()
        self.ready = threading.Event()
        self._thread: threading.Thread | None = None
        self.generation = 0

    def set_application_name(self, name: str) -> None:
        if name:
            with self._lock:
                self._application_name = name

    def configure_runtime(
        self,
        *,
        dsn_provider: Callable[[], str] | None = None,
        dialect_provider: Callable[[], str] | None = None,
    ) -> None:
        with self._lock:
            if dsn_provider is not None:
                self._dsn_provider = dsn_provider
            if dialect_provider is not None:
                self._dialect_provider = dialect_provider

    def _is_postgresql(self) -> bool:
        if self._dialect_provider is not None:
            return self._dialect_provider() == "postgresql"
        from ..database import engine

        return engine.dialect.name == "postgresql"

    def register_handler(self, channel: str, handler: Callable[[str], None]) -> None:
        if channel not in self._channels:
            raise ValueError(f"Canal LISTEN não registrado no multiplexador: {channel}")
        with self._lock:
            handlers = self._handlers.setdefault(channel, [])
            if handler not in handlers:
                handlers.append(handler)

    def start(self) -> None:
        if not self._is_postgresql():
            self.ready.set()
            return
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return
            self._stop.clear()
            self._thread = threading.Thread(
                target=self._listen_forever,
                name="koma-listen-multiplexer",
                daemon=True,
            )
            self._thread.start()

    def stop(self, timeout: float = 12.0) -> None:
        self._stop.set()
        with self._lock:
            thread = self._thread
        if thread is not None and thread.is_alive() and thread is not threading.current_thread():
            thread.join(timeout=timeout)
        with self._lock:
            if self._thread is thread and (thread is None or not thread.is_alive()):
                self._thread = None
        self.ready.clear()

    def is_ready(self) -> bool:
        return self.ready.is_set()

    def wait_ready(self, timeout: float = 10.0) -> bool:
        self.start()
        return self.ready.wait(timeout=timeout)

    def _dispatch_notification(self, channel: str, payload: str) -> None:
        with self._lock:
            handlers = list(self._handlers.get(channel, ()))
        for handler in handlers:
            try:
                handler(payload)
            except Exception as exc:
                # Never let one consumer failure break other channels or the loop.
                logger.warning(
                    "Listen multiplexer handler error channel=%s error=%s",
                    channel,
                    type(exc).__name__,
                )

    def _open_connection(self, dsn: str):
        if self._connect_fn is not None:
            return self._connect_fn(dsn)
        import psycopg2

        with self._lock:
            app_name = self._application_name
        return psycopg2.connect(
            dsn,
            connect_timeout=10,
            application_name=app_name,
            keepalives=1,
            keepalives_idle=30,
            keepalives_interval=10,
            keepalives_count=3,
        )

    def _listen_forever(self) -> None:
        backoff_index = 0
        while not self._stop.is_set():
            connection = None
            cursor = None
            try:
                dsn = normalize_postgres_dsn(self._dsn_provider())
                connection = self._open_connection(dsn)
                connection.autocommit = True
                cursor = connection.cursor()
                for channel in self._channels:
                    cursor.execute(f'LISTEN "{channel}"')
                self.generation += 1
                self.ready.set()
                backoff_index = 0
                logger.info(
                    "PostgreSQL LISTEN multiplexer active channels=%s",
                    ",".join(self._channels),
                )

                while not self._stop.is_set():
                    readable, _, _ = self._select_fn([connection], [], [], 0.5)
                    if not readable:
                        continue
                    connection.poll()
                    while connection.notifies:
                        notification = connection.notifies.pop(0)
                        self._dispatch_notification(
                            notification.channel,
                            notification.payload,
                        )
            except Exception as exc:
                self.ready.clear()
                if not self._stop.is_set():
                    delay = self._backoff_schedule[
                        min(backoff_index, len(self._backoff_schedule) - 1)
                    ]
                    backoff_index += 1
                    logger.warning(
                        "PostgreSQL LISTEN multiplexer reconnecting error=%s delay=%ss",
                        type(exc).__name__,
                        delay,
                    )
                    self._stop.wait(delay)
            finally:
                self.ready.clear()
                if cursor is not None:
                    with contextlib.suppress(Exception):
                        cursor.close()
                if connection is not None:
                    with contextlib.suppress(Exception):
                        connection.close()


listen_multiplexer = PostgresListenMultiplexer()
