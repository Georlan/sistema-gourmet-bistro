"""Real PostgreSQL integration tests for LISTEN/NOTIFY multiplexing."""

from __future__ import annotations

import os
import statistics
import threading
import time

import psycopg2
import pytest

from app.services.postgres_listen_multiplexer import (
    MULTIPLEXED_CHANNELS,
    PostgresListenMultiplexer,
    normalize_postgres_dsn,
)


POSTGRES_URL = os.getenv("KOMA_LISTEN_TEST_POSTGRES_URL") or os.getenv("TEST_POSTGRES_URL")

pytestmark = pytest.mark.skipif(
    not POSTGRES_URL,
    reason="Define KOMA_LISTEN_TEST_POSTGRES_URL to run real PostgreSQL LISTEN integration tests.",
)


def _pg_connect(dsn: str):
    return psycopg2.connect(normalize_postgres_dsn(dsn), connect_timeout=5)


def test_single_session_handles_all_three_channels_commit_rollback_recovery_and_shutdown():
    dsn = normalize_postgres_dsn(POSTGRES_URL)
    mux = PostgresListenMultiplexer(
        dsn_provider=lambda: dsn,
        dialect_provider=lambda: "postgresql",
        backoff_schedule=(0.1, 0.2, 0.5),
    )

    ops_events: list[str] = []
    chat_events: list[str] = []
    print_events: list[str] = []
    all_done = threading.Event()
    expected_total = 30  # 10 bursts * 3 channels

    def _check_done():
        if len(ops_events) + len(chat_events) + len(print_events) >= expected_total:
            all_done.set()

    mux.register_handler("koma_operational_realtime", lambda p: (ops_events.append(p), _check_done()))
    mux.register_handler("koma_order_chat", lambda p: (chat_events.append(p), _check_done()))
    mux.register_handler("koma_print_jobs", lambda p: (print_events.append(p), _check_done()))

    mux.start()
    assert mux.ready.wait(timeout=5.0)
    initial_gen = mux.generation
    assert initial_gen == 1

    # 1. Verify exactly 1 physical LISTEN session in pg_stat_activity listening on all 3 channels.
    with _pg_connect(dsn) as admin_conn:
        admin_conn.autocommit = True
        with admin_conn.cursor() as cur:
            cur.execute(
                "SELECT pid FROM pg_stat_activity "
                "WHERE application_name = 'koma-listen-multiplexer' AND state IS NOT NULL"
            )
            pids = [row[0] for row in cur.fetchall()]
            assert len(pids) == 1, f"Expected 1 LISTEN session, found {len(pids)}"
            listener_pid = pids[0]

        # 2. Verify NO notification leaks before commit or after rollback.
        with admin_conn.cursor() as cur:
            cur.execute("BEGIN")
            cur.execute("SELECT pg_notify('koma_print_jobs', '999')")
            time.sleep(0.1)
            assert print_events == []
            cur.execute("ROLLBACK")
            time.sleep(0.1)
            assert print_events == []

        # 3. Synthetic multi-tenant burst across all 3 channels + latency measurement.
        latencies_ms: list[float] = []
        for idx in range(10):
            tenant_id = (idx % 5) + 1
            t0 = time.perf_counter()
            with admin_conn.cursor() as cur:
                cur.execute(
                    "SELECT pg_notify('koma_operational_realtime', %s), "
                    "pg_notify('koma_order_chat', %s), "
                    "pg_notify('koma_print_jobs', %s)",
                    (
                        f'{{"restaurante_id":{tenant_id},"seq":{idx}}}',
                        f'{{"restaurante_id":{tenant_id},"seq":{idx}}}',
                        str(tenant_id),
                    ),
                )
            # Wait until this burst arrives
            deadline = time.perf_counter() + 2.0
            while len(print_events) <= idx and time.perf_counter() < deadline:
                time.sleep(0.002)
            latencies_ms.append((time.perf_counter() - t0) * 1000.0)

        assert all_done.wait(timeout=5.0)
        assert len(ops_events) == 10
        assert len(chat_events) == 10
        assert len(print_events) == 10

        p50 = statistics.median(latencies_ms)
        p95 = sorted(latencies_ms)[max(0, int(0.95 * len(latencies_ms)) - 1)]
        assert p95 < 250.0, f"Latency too high: p50={p50:.2f}ms p95={p95:.2f}ms"

        # 4. Terminate backend PostgreSQL session and verify degradation + automatic recovery.
        recover_start = time.perf_counter()
        with admin_conn.cursor() as cur:
            cur.execute("SELECT pg_terminate_backend(%s)", (listener_pid,))

        deadline = time.perf_counter() + 5.0
        while mux.generation == initial_gen and time.perf_counter() < deadline:
            time.sleep(0.02)
        assert mux.generation > initial_gen
        assert mux.ready.wait(timeout=5.0)
        recovery_ms = (time.perf_counter() - recover_start) * 1000.0
        assert recovery_ms < 4000.0

        # Confirm delivery works after reconnect
        post_reconnect = threading.Event()
        mux.register_handler("koma_print_jobs", lambda p: (print_events.append(p), post_reconnect.set()))
        with admin_conn.cursor() as cur:
            cur.execute("SELECT pg_notify('koma_print_jobs', '77')")
        assert post_reconnect.wait(timeout=3.0)

    # 5. Clean shutdown leaves zero sessions and no orphan thread.
    mux.stop(timeout=5.0)
    assert not mux.is_ready()
    assert mux._thread is None

    with _pg_connect(dsn) as check_conn:
        with check_conn.cursor() as cur:
            cur.execute(
                "SELECT count(*) FROM pg_stat_activity "
                "WHERE application_name = 'koma-listen-multiplexer'"
            )
            assert cur.fetchone()[0] == 0

    print(
        f"[LISTEN BENCH] channels={len(MULTIPLEXED_CHANNELS)} sessions=1 "
        f"p50={p50:.2f}ms p95={p95:.2f}ms recovery={recovery_ms:.1f}ms"
    )
