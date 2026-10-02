import json
import sqlite3
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import create_engine
from sqlalchemy.exc import TimeoutError

from app.pool_observability import ObservedQueuePool, pool_snapshot


def test_saturation_timeout_is_counted_without_connection_leak(caplog):
    engine = create_engine('sqlite://', poolclass=ObservedQueuePool,
                           pool_size=1, max_overflow=0, pool_timeout=0.02)
    held = engine.connect()
    try:
        with pytest.raises(TimeoutError):
            engine.connect()
        snap = pool_snapshot(engine)
        assert snap['checked_out'] == 1
        assert snap['timeout_count'] == 1
        assert snap['acquire_count'] == 2
        events = [json.loads(r.message) for r in caplog.records]
        assert events[-1]['event'] == 'db_pool_timeout'
        assert events[-1]['acquire_ms'] >= 15
        assert 'sqlite' not in caplog.text
    finally:
        held.close()
    assert pool_snapshot(engine)['checked_out'] == 0
    with engine.connect():
        assert pool_snapshot(engine)['checked_out'] == 1
    engine.dispose()


def test_acquire_measures_wait_and_releases_normally():
    pool = ObservedQueuePool(lambda: sqlite3.connect(':memory:', check_same_thread=False),
                             pool_size=1, max_overflow=0, timeout=1)
    held = pool.connect()
    started = threading.Event()
    def acquire():
        started.set()
        connection = pool.connect()
        connection.close()
    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(acquire)
        assert started.wait(1)
        time.sleep(.03)
        held.close()
        future.result(timeout=2)
    assert pool.snapshot()['acquire_max_ms'] >= 20
    assert pool.snapshot()['timeout_count'] == 0
    assert pool.snapshot()['checked_out'] == 0
    pool.dispose()
