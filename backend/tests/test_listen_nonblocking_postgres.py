"""PostgreSQL concurrency & multiplexer non-blocking integration tests."""

from __future__ import annotations

import asyncio
import os
import threading
import time

import psycopg2
import pytest

from app.services.order_chat_hub import ORDER_CHAT_CHANNEL, OrderChatHub
from app.services.postgres_listen_multiplexer import (
    PostgresListenMultiplexer,
    normalize_postgres_dsn,
)
from app.services.print_delivery import PRINT_WAKEUP_CHANNEL


POSTGRES_URL = (
    os.getenv("KOMA_LISTEN_TEST_POSTGRES_URL")
    or os.getenv("TEST_POSTGRES_URL")
)

pytestmark = pytest.mark.skipif(
    not POSTGRES_URL,
    reason="Define KOMA_LISTEN_TEST_POSTGRES_URL to run real PostgreSQL integration tests.",
)


def test_slow_chat_rehydration_does_not_block_print_or_operational_channels(monkeypatch):
    dsn = normalize_postgres_dsn(POSTGRES_URL)
    mux = PostgresListenMultiplexer(
        dsn_provider=lambda: dsn,
        dialect_provider=lambda: "postgresql",
    )

    chat_hub = OrderChatHub(listen_to_postgres=True, multiplexer=mux)
    chat_started = threading.Event()
    chat_done = threading.Event()
    print_received = threading.Event()
    ops_received = threading.Event()
    latencies: dict[str, float] = {}

    def slow_publish(envelope):
        chat_started.set()
        time.sleep(0.35)
        chat_done.set()

    monkeypatch.setattr(chat_hub, "publish_committed", slow_publish)
    mux.register_handler(
        "koma_operational_realtime",
        lambda _p: ops_received.set(),
    )
    mux.register_handler(
        PRINT_WAKEUP_CHANNEL,
        lambda _p: print_received.set(),
    )
    mux.register_handler(ORDER_CHAT_CHANNEL, chat_hub._handle_notify)

    async def scenario():
        from concurrent.futures import ThreadPoolExecutor

        with chat_hub._lock:
            chat_hub._notify_executor = ThreadPoolExecutor(
                max_workers=1, thread_name_prefix="test-chat-rehydrate",
            )
        mux.start()
        assert mux.ready.wait(timeout=5.0)
        try:
            conn = psycopg2.connect(dsn)
            conn.autocommit = True
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT pg_notify('koma_order_chat', %s)",
                        ('{"restaurante_id":1,"conversation_id":"c1","kind":"message"}',),
                    )
                    assert chat_started.wait(timeout=2.0)

                    t0 = time.perf_counter()
                    cur.execute(
                        "SELECT pg_notify('koma_print_jobs', %s), "
                        "pg_notify('koma_operational_realtime', %s)",
                        ("1", '{"event":"tables_updated"}'),
                    )
                    assert print_received.wait(timeout=0.5)
                    assert ops_received.wait(timeout=0.5)
                    latencies["print_and_ops_during_slow_chat_ms"] = (
                        time.perf_counter() - t0
                    ) * 1000.0
                    assert latencies["print_and_ops_during_slow_chat_ms"] < 150.0
                    assert chat_done.wait(timeout=2.0)
            finally:
                conn.close()
        finally:
            mux.stop(timeout=3.0)
            with chat_hub._lock:
                ex = chat_hub._notify_executor
                chat_hub._notify_executor = None
            if ex is not None:
                ex.shutdown(wait=True)

    asyncio.run(scenario())
    print(
        "[MUX NON-BLOCKING] print_and_ops_during_350ms_chat_ms="
        f"{latencies['print_and_ops_during_slow_chat_ms']:.2f}"
    )
