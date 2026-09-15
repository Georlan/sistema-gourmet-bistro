from __future__ import annotations

import asyncio
import contextlib
import os
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI

from ..fiscal.reference_watch_worker import run_reference_watch_worker


def _enabled() -> bool:
    return (
        os.getenv("ENABLE_FISCAL_REFERENCE_WATCHER", "false").strip().lower() == "true"
        and os.getenv("ENVIRONMENT", "").strip().lower() != "test"
    )


@asynccontextmanager
async def fiscal_reference_lifespan(_app: FastAPI):
    task: asyncio.Task[None] | None = None
    if _enabled():
        task = asyncio.create_task(
            run_reference_watch_worker(),
            name="koma-fiscal-reference-watch",
        )
        print("[FISCAL] Worker de referências oficiais iniciado.", flush=True)

    try:
        yield
    finally:
        if task is not None:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
            print("[FISCAL] Worker de referências oficiais finalizado.", flush=True)


router = APIRouter(lifespan=fiscal_reference_lifespan)
