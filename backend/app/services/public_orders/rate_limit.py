"""Rate limiting e barreiras operacionais para pedidos públicos do cardápio digital."""

from __future__ import annotations

import datetime
from fastapi import HTTPException, Request, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...models import PublicRateLimit
from ..customer_auth import hash_public_rate_key
from ..online_order_control import (
    auto_pause_if_capacity_reached,
    customer_is_blocked,
)

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
    detail: str | None = None,
) -> None:
    """Consome uma cota de rate limit e persiste no banco.

    A chave recebida nunca é persistida em claro: ``hash_public_rate_key`` gera
    o fingerprint tenant/scoped antes da consulta/insert.
    """
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
        try:
            nested = db.begin_nested()
            candidate = PublicRateLimit(
                restaurante_id=restaurante_id,
                scope=scope,
                key_hash=key_hash,
                requisicoes=1,
                janela_iniciada_em=now,
            )
            db.add(candidate)
            nested.commit()
            return
        except IntegrityError:
            nested.rollback()
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
                raise  # pragma: no cover

    janela_iniciada = rate.janela_iniciada_em
    if janela_iniciada.tzinfo is None:
        janela_iniciada = janela_iniciada.replace(tzinfo=datetime.timezone.utc)

    segundos_decorridos = (now - janela_iniciada).total_seconds()
    if segundos_decorridos >= window_seconds:
        rate.requisicoes = 1
        rate.janela_iniciada_em = now
        return

    if rate.requisicoes >= max_requests:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=detail or "Limite de pedidos excedido temporariamente. Tente novamente mais tarde.",
        )

    rate.requisicoes += 1


def enforce_public_order_rate_limits(
    db: Session,
    *,
    request: Request,
    restaurante_id: int,
    telefone: str,
) -> None:
    """Aplica barreiras antes da transação crítica de criação do pedido.

    Ordem intencional:
    1. bloqueio tenant-local do cliente;
    2. pausa manual/auto-pausa por capacidade;
    3. quotas por telefone e IP.

    A auto-pausa e as quotas são commitadas antes da transação do pedido para
    sobreviver ao rollback posterior do adapter. Isso garante que uma pausa
    confirmada entre duas requisições passe a valer imediatamente na borda.
    """
    if customer_is_blocked(
        db,
        restaurante_id=restaurante_id,
        telefone=telefone,
    ):
        # Mensagem deliberadamente neutra: não revela regra antifraude, motivo,
        # duração ou existência de um bloqueio administrativo.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Não foi possível receber um novo pedido com estes dados neste momento.",
        )

    if auto_pause_if_capacity_reached(db, restaurante_id=restaurante_id):
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Novos pedidos estão temporariamente pausados. Tente novamente mais tarde.",
        )

    consume_rate_limit(
        db,
        restaurante_id=restaurante_id,
        scope="public_order_phone",
        raw_key=telefone,
        max_requests=MAX_PUBLIC_ORDERS_PER_PHONE,
        window_seconds=PUBLIC_ORDER_RATE_WINDOW_SECONDS,
    )
    db.commit()

    consume_rate_limit(
        db,
        restaurante_id=restaurante_id,
        scope="public_order_ip",
        raw_key=client_ip(request),
        max_requests=MAX_PUBLIC_ORDERS_PER_IP,
        window_seconds=PUBLIC_ORDER_RATE_WINDOW_SECONDS,
    )
    db.commit()
