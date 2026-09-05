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
