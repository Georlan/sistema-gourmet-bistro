from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any

from .reference_watch_runner import run_reference_watch


logger = logging.getLogger("koma.fiscal.reference_watch_worker")

DEFAULT_INTERVAL_HOURS = 24.0
MIN_INTERVAL_SECONDS = 3600.0
DEFAULT_STARTUP_DELAY_SECONDS = 20.0


def reference_watch_interval_seconds() -> float:
    raw = os.getenv("FISCAL_REFERENCE_WATCH_INTERVAL_HOURS", str(DEFAULT_INTERVAL_HOURS))
    try:
        hours = float(raw)
    except (TypeError, ValueError):
        hours = DEFAULT_INTERVAL_HOURS
    return max(MIN_INTERVAL_SECONDS, hours * 3600.0)


def reference_watch_startup_delay_seconds() -> float:
    raw = os.getenv(
        "FISCAL_REFERENCE_WATCH_STARTUP_DELAY_SECONDS",
        str(DEFAULT_STARTUP_DELAY_SECONDS),
    )
    try:
        seconds = float(raw)
    except (TypeError, ValueError):
        seconds = DEFAULT_STARTUP_DELAY_SECONDS
    return max(0.0, min(seconds, 300.0))


def reference_watch_log_payload(outcome: dict[str, Any]) -> dict[str, object]:
    """Resumo operacional seguro: sem conteúdo fiscal completo nem segredos."""

    return {
        "event": "fiscal_reference_watch",
        "ok": outcome.get("ok"),
        "requires_attention": outcome.get("requiresAttention"),
        "skipped": outcome.get("skipped", False),
        "sources": [
            item.get("sourceKey")
            for item in outcome.get("results", [])
            if isinstance(item, dict)
        ],
        "error_sources": [
            item.get("sourceKey")
            for item in outcome.get("errors", [])
            if isinstance(item, dict)
        ],
    }


def emit_reference_watch_log(outcome: dict[str, Any]) -> None:
    """Sempre emite uma linha estruturada, inclusive quando o logger INFO é filtrado."""

    payload = reference_watch_log_payload(outcome)
    serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    print(serialized, flush=True)
    if outcome.get("requiresAttention"):
        logger.warning(serialized)


async def run_reference_watch_worker() -> None:
    """Observa fontes oficiais periodicamente sem bloquear o event loop HTTP."""

    startup_delay = reference_watch_startup_delay_seconds()
    if startup_delay:
        await asyncio.sleep(startup_delay)

    interval = reference_watch_interval_seconds()
    while True:
        try:
            outcome = await asyncio.to_thread(run_reference_watch)
            emit_reference_watch_log(outcome)
        except asyncio.CancelledError:
            raise
        except Exception:
            # O watcher jamais derruba o backend nem o fluxo de venda. Falha fica
            # observável e uma nova rodada ocorrerá no próximo intervalo.
            logger.exception("Falha inesperada no worker de referências fiscais oficiais")

        await asyncio.sleep(interval)
