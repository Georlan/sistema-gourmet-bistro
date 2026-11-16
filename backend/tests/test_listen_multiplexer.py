"""Unit tests for PostgresListenMultiplexer reliability, isolation, and shutdown."""

from __future__ import annotations

import threading
import time
from types import SimpleNamespace

from app.services.postgres_listen_multiplexer import (
    MULTIPLEXED_CHANNELS,
    PostgresListenMultiplexer,
)


class _FakeCursor:
    def __init__(self, listened: list[str]) -> None:
        self._listened = listened

    def execute(self, sql: str) -> None:
        self._listened.append(sql)

    def close(self) -> None:
        pass


class _FakeConnection:
    def __init__(self, listened: list[str], notifies: list[tuple[str, str]] | None = None) -> None:
        self._listened = listened
        self.autocommit = False
        self.notifies = [SimpleNamespace(channel=ch, payload=pl) for ch, pl in (notifies or [])]
        self.closed = False

    def cursor(self) -> _FakeCursor:
        return _FakeCursor(self._listened)

    def poll(self) -> None:
        pass

    def close(self) -> None:
        self.closed = True


def test_multiplexer_registers_all_three_channels_on_single_connection_and_starts_once():
    listened: list[str] = []
    connect_calls = 0
    connect_lock = threading.Lock()
    stop_gate = threading.Event()

    def fake_connect(_dsn: str):
        nonlocal connect_calls
        with connect_lock:
            connect_calls += 1
        return _FakeConnection(listened)

    def fake_select(rlist, _w, _x, _timeout):
        stop_gate.wait(0.05)
        return ([], [], [])

    mux = PostgresListenMultiplexer(
        dsn_provider=lambda: "postgresql://u:p@localhost/db",
        dialect_provider=lambda: "postgresql",
        connect_fn=fake_connect,
        select_fn=fake_select,
    )

    barrier = threading.Barrier(4)
    threads = [
        threading.Thread(target=lambda: (barrier.wait(), mux.start()))
        for _ in range(4)
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=2.0)

    assert mux.ready.wait(timeout=2.0)
    assert connect_calls == 1
    assert listened == [f'LISTEN "{ch}"' for ch in MULTIPLEXED_CHANNELS]

    mux.stop(timeout=2.0)
    assert not mux.is_ready()
    assert mux._thread is None


def test_consumer_exception_does_not_affect_other_channels():
    received_ops: list[str] = []
    received_print: list[str] = []
    delivered = threading.Event()

    def fake_connect(_dsn: str):
        return _FakeConnection(
            [],
            notifies=[
                ("koma_order_chat", '{"bad":true}'),
                ("koma_operational_realtime", '{"ok":1}'),
                ("koma_print_jobs", "42"),
            ],
        )

    def fake_select(rlist, _w, _x, _timeout):
        if rlist and rlist[0].notifies:
            return (rlist, [], [])
        time.sleep(0.02)
        return ([], [], [])

    mux = PostgresListenMultiplexer(
        dsn_provider=lambda: "postgresql://u:p@localhost/db",
        dialect_provider=lambda: "postgresql",
        connect_fn=fake_connect,
        select_fn=fake_select,
    )
    mux.register_handler("koma_order_chat", lambda _p: (_ for _ in ()).throw(RuntimeError("boom")))
    mux.register_handler("koma_operational_realtime", lambda p: received_ops.append(p))
    mux.register_handler(
        "koma_print_jobs",
        lambda p: (received_print.append(p), delivered.set()),
    )

    mux.start()
    assert delivered.wait(timeout=2.0)
    mux.stop(timeout=2.0)

    assert received_ops == ['{"ok":1}']
    assert received_print == ["42"]


def test_reconnect_clears_ready_and_uses_bounded_backoff():
    attempts = 0
    recovered = threading.Event()

    def fake_connect(_dsn: str):
        nonlocal attempts
        attempts += 1
        if attempts <= 2:
            raise ConnectionError("db unavailable")
        recovered.set()
        return _FakeConnection([])

    def fake_select(_rlist, _w, _x, _timeout):
        time.sleep(0.02)
        return ([], [], [])

    mux = PostgresListenMultiplexer(
        dsn_provider=lambda: "postgresql://u:p@localhost/db",
        dialect_provider=lambda: "postgresql",
        connect_fn=fake_connect,
        select_fn=fake_select,
        backoff_schedule=(0.02, 0.04),
    )

    assert not mux.is_ready()
    mux.start()
    assert recovered.wait(timeout=2.0)
    assert mux.ready.wait(timeout=2.0)
    assert mux.generation == 1
    mux.stop(timeout=2.0)
