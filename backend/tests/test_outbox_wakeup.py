import asyncio

from app.services.outbox.worker import OutboxWorker


def test_commit_hint_wakes_idle_worker_without_waiting_for_poll(monkeypatch):
    async def scenario():
        loop = asyncio.get_running_loop()
        first_scan, next_scan = asyncio.Event(), asyncio.Event()
        scans = 0
        worker = OutboxWorker(poll_interval_seconds=30)

        def scan():
            nonlocal scans
            scans += 1
            loop.call_soon_threadsafe((first_scan if scans == 1 else next_scan).set)
            return {"total": 0, "recovered_stale": 0, "scheduled_released": 0}

        monkeypatch.setattr(worker, "run_once", scan)
        worker.start()
        try:
            await asyncio.wait_for(first_scan.wait(), 5)
            await asyncio.to_thread(worker.wake)
            await asyncio.wait_for(next_scan.wait(), 5)
        finally:
            await worker.stop()
        assert scans >= 2
        assert not worker.is_running

    asyncio.run(scenario())


def test_active_restaurant_discovery_is_cached(monkeypatch):
    calls = []
    now = [100.0]
    worker = OutboxWorker(
        restaurant_cache_ttl_seconds=60,
        max_idle_seconds=60,
    )

    monkeypatch.setattr(
        "app.services.outbox.worker.time.monotonic",
        lambda: now[0],
    )

    def discover(_db):
        calls.append(now[0])
        return [1, 2]

    monkeypatch.setattr(
        "app.services.outbox.worker.discover_active_restaurant_ids",
        discover,
    )

    sentinel_db = object()
    assert worker._active_restaurant_ids(sentinel_db) == [1, 2]
    now[0] = 130.0
    assert worker._active_restaurant_ids(sentinel_db) == [1, 2]
    assert len(calls) == 1

    now[0] = 161.0
    assert worker._active_restaurant_ids(sentinel_db) == [1, 2]
    assert len(calls) == 2


def test_idle_backoff_has_configurable_safe_cap():
    worker = OutboxWorker(
        poll_interval_seconds=2,
        max_idle_seconds=60,
    )

    delay = worker.poll_interval_seconds
    for _ in range(20):
        delay = min(worker.max_idle_seconds, delay * 2)

    assert delay == 60
