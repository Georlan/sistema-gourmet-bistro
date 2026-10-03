"""Bounded pool diagnostics: metadata only, never SQL, arguments or credentials."""

import json
import logging
from time import monotonic
from traceback import extract_stack

from sqlalchemy import event
from sqlalchemy.pool import QueuePool

logger = logging.getLogger(__name__)
_KEY = "koma_checkout_diagnostic"


def install_pool_diagnostics(engine, tenant_id, *, slow_seconds=5.0):
    if not isinstance(engine.pool, QueuePool):
        return
    pool = engine.pool

    @event.listens_for(pool, "checkout")
    def checkout(connection, record, proxy):
        origin = "unknown"
        for frame in reversed(extract_stack(limit=30)):
            normalized = frame.filename.replace("\\", "/")
            if "/app/" in normalized and not normalized.endswith(("database.py", "database_diagnostics.py")):
                origin = normalized.rsplit("/app/", 1)[1] + ":" + frame.name
                break
        record.info[_KEY] = (monotonic(), tenant_id(), origin)

    @event.listens_for(pool, "checkin")
    def checkin(connection, record):
        metadata = record.info.pop(_KEY, None)
        if metadata is None:
            return
        started, restaurant, origin = metadata
        duration = monotonic() - started
        if duration >= slow_seconds:
            logger.warning(json.dumps({
                "event": "sql_connection_held",
                "duration_ms": round(duration * 1000, 2),
                "restaurante_id": restaurant,
                "origin": origin,
                "pool_size": pool.size(),
                # checkin fires before the slot is returned to the queue.
                "checked_out_before_return": pool.checkedout(),
                "overflow": max(0, pool.overflow()),
            }, separators=(",", ":")))
