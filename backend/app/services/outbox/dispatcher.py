"""Despachador assíncrono e resiliente de eventos da IntegrationOutbox."""

from __future__ import annotations

import datetime
import json
import logging
from typing import Any, Optional
import httpx
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ...models import ConfiguracaoRestaurante, IntegrationOutbox
from .signer import build_webhook_headers

logger = logging.getLogger("koma.outbox.dispatcher")

DEFAULT_TIMEOUT_SECONDS = 5.0


def _calculate_backoff_seconds(attempts: int) -> int:
    """Calcula backoff exponencial: 10s, 20s, 40s, 80s, até o teto de 1h."""
    return min(3600, (2 ** max(1, attempts)) * 5)


def dispatch_single_outbox_event(
    db: Session,
    event_record: IntegrationOutbox,
    *,
    client: Optional[httpx.Client] = None,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
) -> bool:
    """Despacha um único registro da Outbox para o webhook configurado."""
    now = datetime.datetime.now(datetime.timezone.utc)
    config = (
        db.query(ConfiguracaoRestaurante)
        .filter(ConfiguracaoRestaurante.restaurante_id == event_record.restaurante_id)
        .first()
    )

    webhook_url = (config.webhook_url or "").strip() if config else ""
    webhook_secret = (config.webhook_secret or "").strip() if config else ""
    webhook_ativo = bool(config.webhook_ativo) if config else False

    # Se o webhook não estiver configurado ou inativo, marcamos como entregue/concluído sem envio
    if not webhook_ativo or not webhook_url:
        event_record.status = "delivered"
        event_record.processed_at = now
        event_record.last_error = "Webhook inativo ou não configurado para o restaurante."
        db.commit()
        return True

    payload_bytes = json.dumps(event_record.payload, ensure_ascii=False).encode("utf-8")
    headers = build_webhook_headers(
        secret=webhook_secret,
        payload_bytes=payload_bytes,
        event_id=event_record.event_id,
        event_name=event_record.event_name,
    )

    http_client = client or httpx.Client(timeout=timeout_seconds)
    close_client = client is None

    try:
        response = http_client.post(webhook_url, content=payload_bytes, headers=headers)
        event_record.response_status_code = response.status_code

        if 200 <= response.status_code < 300:
            event_record.status = "delivered"
            event_record.processed_at = now
            event_record.last_error = None
            db.commit()
            return True
        else:
            raise RuntimeError(f"HTTP {response.status_code}: {response.text[:200]}")

    except Exception as exc:
        event_record.attempts += 1
        event_record.last_error = str(exc)[:500]

        if event_record.attempts >= event_record.max_attempts:
            event_record.status = "dead_letter"
            event_record.processed_at = now
            logger.error(
                "[OUTBOX DEAD LETTER] Evento %s (%s) atingiu limite de %d tentativas: %s",
                event_record.event_id,
                event_record.event_name,
                event_record.max_attempts,
                exc,
            )
        else:
            event_record.status = "failed"
            delay = _calculate_backoff_seconds(event_record.attempts)
            event_record.next_retry_at = now + datetime.timedelta(seconds=delay)
            logger.warning(
                "[OUTBOX RETRY] Evento %s falhou (tentativa %d/%d). Próximo retry em %ds: %s",
                event_record.event_id,
                event_record.attempts,
                event_record.max_attempts,
                delay,
                exc,
            )

        db.commit()
        return False
    finally:
        if close_client:
            http_client.close()


def dispatch_pending_outbox_events(
    db: Session,
    *,
    batch_size: int = 50,
    client: Optional[httpx.Client] = None,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
) -> dict[str, int]:
    """Varre e despacha eventos pendentes ou falhos prontos para retry."""
    now = datetime.datetime.now(datetime.timezone.utc)
    
    query = (
        db.query(IntegrationOutbox)
        .filter(
            IntegrationOutbox.status.in_(["pending", "failed"]),
            or_(
                IntegrationOutbox.next_retry_at.is_(None),
                IntegrationOutbox.next_retry_at <= now,
            ),
        )
        .order_by(IntegrationOutbox.created_at.asc())
        .limit(batch_size)
    )

    try:
        # PostgreSQL SKIP LOCKED para concorrência segura entre múltiplos workers
        events = query.with_for_update(skip_locked=True).all()
    except Exception:
        # Fallback para SQLite ou drivers que não suportam SKIP LOCKED
        events = query.all()

    stats = {"total": len(events), "delivered": 0, "failed": 0, "dead_letter": 0}

    for ev in events:
        success = dispatch_single_outbox_event(
            db,
            ev,
            client=client,
            timeout_seconds=timeout_seconds,
        )
        if success:
            stats["delivered"] += 1
        elif ev.status == "dead_letter":
            stats["dead_letter"] += 1
        else:
            stats["failed"] += 1

    return stats
