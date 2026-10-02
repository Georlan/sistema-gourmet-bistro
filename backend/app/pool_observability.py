"""Process-local pool evidence; no SQL, credentials or tenant payloads in logs."""
import json
import logging
from threading import Lock
from time import perf_counter

from sqlalchemy.exc import TimeoutError
from sqlalchemy.pool import QueuePool

logger = logging.getLogger("koma.database.pool")


class ObservedQueuePool(QueuePool):
    """Measure public connect(), including queue wait, connect and pre-ping.

    acquire_ms is deliberately NOT advertised as pure queue wait. Counters reset
    on process restart; snapshots are observations, not atomic capacity promises.
    """

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._metrics_lock = Lock()
        self._acquires = 0
        self._timeouts = 0
        self._acquire_total_ms = 0.0
        self._acquire_max_ms = 0.0

    def snapshot(self):
        with self._metrics_lock:
            return {
                "size": self.size(), "checked_in": self.checkedin(),
                "checked_out": self.checkedout(), "overflow": self.overflow(),
                "acquire_count": self._acquires, "timeout_count": self._timeouts,
                "acquire_total_ms": round(self._acquire_total_ms, 2),
                "acquire_max_ms": round(self._acquire_max_ms, 2),
            }

    def connect(self):
        started = perf_counter()
        timed_out = False
        try:
            return super().connect()
        except TimeoutError:
            timed_out = True
            raise
        finally:
            elapsed = (perf_counter() - started) * 1000
            with self._metrics_lock:
                self._acquires += 1
                self._timeouts += int(timed_out)
                self._acquire_total_ms += elapsed
                self._acquire_max_ms = max(self._acquire_max_ms, elapsed)
            if timed_out or elapsed >= 250:
                logger.warning(json.dumps({
                    "event": "db_pool_timeout" if timed_out else "db_pool_slow_acquire",
                    "acquire_ms": round(elapsed, 2), **self.snapshot(),
                }, separators=(",", ":")))


def pool_snapshot(engine):
    pool = engine.pool
    return pool.snapshot() if isinstance(pool, ObservedQueuePool) else None
