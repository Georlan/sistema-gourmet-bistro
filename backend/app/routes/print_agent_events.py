"""Server-Sent Events wake-up channel for Kôma Print Agent.

The stream is deliberately non-authoritative: it never contains ticket content
or a claim. It only tells the agent to call the durable claim-batch endpoint now.
"""

from __future__ import annotations

import asyncio
import json
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy import text

from ..database import SessionLocal
from ..services.print_delivery import print_wakeup_hub
from .print_agents import hash_token


router = APIRouter()


def _authenticate_agent_token(raw_token: str) -> tuple[str, int]:
    token = (raw_token or "").strip()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token de agente ausente",
        )

    db = SessionLocal()
    try:
        token_hash = hash_token(token)
        if db.get_bind().dialect.name == "postgresql":
            identity = db.execute(
                text(
                    "SELECT id, restaurante_id "
                    "FROM koma_internal.auth_print_agent(:token_hash)"
                ),
                {"token_hash": token_hash},
            ).mappings().first()
        else:
            identity = db.execute(
                text(
                    "SELECT id, restaurante_id "
                    "FROM print_agent_tokens "
                    "WHERE token_hash = :token_hash AND ativo = 1 "
                    "LIMIT 1"
                ),
                {"token_hash": token_hash},
            ).mappings().first()
    finally:
        db.close()

    if not identity:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token de agente inválido ou revogado",
        )
    restaurante_id = int(identity["restaurante_id"])
    if restaurante_id <= 0:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token de agente inválido ou revogado",
        )
    return str(identity["id"]), restaurante_id


def _sse(event: str, payload: dict) -> str:
    return (
        f"event: {event}\n"
        f"data: {json.dumps(payload, separators=(',', ':'))}\n\n"
    )


@router.get("/events", summary="Acordar Print Agent quando houver trabalho")
async def stream_print_job_wakeups(
    request: Request,
    x_agent_token: Optional[str] = Header(default=None, alias="X-Agent-Token"),
):
    """Streams commit-safe wake-up hints; the agent still claims from PostgreSQL."""

    agent_id, restaurante_id = await asyncio.to_thread(
        _authenticate_agent_token,
        x_agent_token or "",
    )

    async def event_stream():
        subscription_id, queue = print_wakeup_hub.subscribe(restaurante_id)
        try:
            transport = print_wakeup_hub.transport_status()
            yield _sse(
                "transport",
                {
                    **transport,
                    "agent_id": agent_id,
                },
            )
            # Always claim once after connecting. Any job committed while the
            # stream was disconnected is therefore recovered immediately.
            yield _sse(
                "ready",
                {
                    **transport,
                    "restaurante_id": restaurante_id,
                },
            )

            while not await request.is_disconnected():
                try:
                    payload = await asyncio.wait_for(queue.get(), timeout=20.0)
                except asyncio.TimeoutError:
                    # Transport status doubles as keepalive and lets an agent
                    # fall back to polling if LISTEN is temporarily degraded.
                    yield _sse("transport", print_wakeup_hub.transport_status())
                    continue

                yield _sse(
                    "print-job",
                    {
                        "restaurante_id": restaurante_id,
                        "reason": payload.get("reason") or "queue-changed",
                    },
                )
        finally:
            print_wakeup_hub.unsubscribe(restaurante_id, subscription_id)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )
