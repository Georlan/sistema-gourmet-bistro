"""Utilitários compartilhados para limites de tamanho de payload HTTP e webhooks."""

from __future__ import annotations

import json
from typing import Any

from fastapi import HTTPException, Request, status

DEFAULT_WEBHOOK_MAX_BYTES = 256 * 1024  # 256 KB
DEFAULT_GLOBAL_MAX_BODY_BYTES = 12 * 1024 * 1024  # 12 MB (acima do XML NF-e de 10 MB)


async def read_limited_body(
    request: Request,
    *,
    max_bytes: int = DEFAULT_WEBHOOK_MAX_BYTES,
    detail: str = "Notificação excede o tamanho máximo permitido.",
) -> bytes:
    """Lê o corpo HTTP em streaming falhando fechado com 413 se exceder ``max_bytes``."""
    raw_content_length = (request.headers.get("content-length") or "").strip()
    if raw_content_length:
        try:
            if int(raw_content_length) > max_bytes:
                raise HTTPException(
                    status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                    detail=detail,
                )
        except ValueError:
            pass

    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > max_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                detail=detail,
            )
        body.extend(chunk)
    return bytes(body)


async def read_limited_json(
    request: Request,
    *,
    max_bytes: int = DEFAULT_WEBHOOK_MAX_BYTES,
    allow_empty: bool = False,
    invalid_status: int = status.HTTP_400_BAD_REQUEST,
    invalid_detail: str = "Payload JSON inválido.",
) -> dict[str, Any]:
    """Lê JSON limitado por tamanho sem alocar payloads arbitrários em memória."""
    raw = await read_limited_body(request, max_bytes=max_bytes)
    if not raw.strip():
        if allow_empty:
            return {}
        raise HTTPException(status_code=invalid_status, detail=invalid_detail)
    try:
        parsed = json.loads(raw)
    except (ValueError, TypeError, UnicodeDecodeError):
        raise HTTPException(status_code=invalid_status, detail=invalid_detail) from None
    if not isinstance(parsed, dict):
        raise HTTPException(status_code=invalid_status, detail=invalid_detail)
    return parsed
