"""Rate limiting para requisições e pedidos públicos do cardápio digital."""

from __future__ import annotations

import datetime
from fastapi import Request
from sqlalchemy.orm import Session

from ...models import PublicRateLimit
from ..customer_auth import hash_public_rate_key

MAX_PUBLIC_ORDER_UNITS = 200
PUBLIC_ORDER_RATE_WINDOW_SECONDS = 15 * 60
MAX_PUBLIC_ORDERS_PER_PHONE = 8
MAX_PUBLIC_ORDERS_PER_IP = 120


def client_ip(request: Request) -> str:
    """Extrai o IP real do cliente considerando headers de proxy/forwarded."""
    forwarded = (request.headers.get("x-forwarded-for") or "").split(",", 1)[0].strip()
    if forwarded:
        return forwarded
    return request.client.host if request.client else "unknown"


def consume_rate_limit(
    db: Session,
    *,
    restaurante_id: int,
    scope: str,
    raw_key: str,
    max_requests: int,
    window_seconds: int,
) -> None:
    """Consome uma cota de rate limit e persiste no banco."""
    now = datetime.datetime.now(datetime.timezone.utc)
    key_hash = hash_public_rate_key(restaurante_id, scope, raw_key)
    rate = (
        db.query(PublicRateLimit)
        .filter(
            PublicRateLimit.restaurante_id == restaurante_id,
            PublicRateLimit.scope == scope,
            PublicRateLimit.key_hash == key_hash,
        )
        .with_for_update()
        .first()
    )

    if rate is None:
        candidate = PublicRateLimit(
            restaurante_id=restaurante_id,
            scope=scope,
            key_hash=key_hash,
            requisicoes=1,
            janela_iniciada_em=now,
        )
        db.add(candidate)
        return

    janela_iniciada = rate.janela_iniciada_em
    if janela_iniciada.tzinfo is None:
        janela_iniciada = janela_iniciada.replace(tzinfo=datetime.timezone.utc)

    segundos_decorridos = (now - janela_iniciada).total_seconds()
    if segundos_decorridos >= window_seconds:
        rate.requisicoes = 1
        rate.janela_iniciada_em = now
        return

    if rate.requisicoes >= max_requests:
        from fastapi import HTTPException, status
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Limite de pedidos excedido temporariamente. Tente novamente mais tarde.",
        )

    rate.requisicoes += 1


def enforce_public_order_rate_limits(
    db: Session,
    *,
    request: Request,
    restaurante_id: int,
    telefone: str,
) -> None:
    """Persiste limites antes da transação do pedido para resistir a payloads inválidos."""
    import sys
    cardapio_mod = sys.modules.get("app.routes.cardapio")
    max_phone = getattr(cardapio_mod, "MAX_PUBLIC_ORDERS_PER_PHONE", MAX_PUBLIC_ORDERS_PER_PHONE) if cardapio_mod else MAX_PUBLIC_ORDERS_PER_PHONE
    max_ip = getattr(cardapio_mod, "MAX_PUBLIC_ORDERS_PER_IP", MAX_PUBLIC_ORDERS_PER_IP) if cardapio_mod else MAX_PUBLIC_ORDERS_PER_IP
    window_sec = getattr(cardapio_mod, "PUBLIC_ORDER_RATE_WINDOW_SECONDS", PUBLIC_ORDER_RATE_WINDOW_SECONDS) if cardapio_mod else PUBLIC_ORDER_RATE_WINDOW_SECONDS

    consume_rate_limit(
        db,
        restaurante_id=restaurante_id,
        scope="public_order_phone",
        raw_key=telefone,
        max_requests=max_phone,
        window_seconds=window_sec,
    )
    db.commit()

    consume_rate_limit(
        db,
        restaurante_id=restaurante_id,
        scope="public_order_ip",
        raw_key=client_ip(request),
        max_requests=max_ip,
        window_seconds=window_sec,
    )
    db.commit()
