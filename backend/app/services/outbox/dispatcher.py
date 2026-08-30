"""Despachador assíncrono e resiliente de eventos da IntegrationOutbox com claim transacional em duas fases."""

from __future__ import annotations

import datetime
import json
import logging
import uuid
from typing import Any, Optional
import httpx
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ...models import ConfiguracaoRestaurante, IntegrationOutbox
from .signer import build_webhook_headers

logger = logging.getLogger("koma.outbox.dispatcher")

DEFAULT_TIMEOUT_SECONDS = 5.0
DEFAULT_STALE_TIMEOUT_SECONDS = 120
DEFAULT_BATCH_SIZE = 20


def _calculate_backoff_seconds(attempts: int) -> int:
    """Calcula backoff exponencial: 10s, 20s, 40s, 80s, até o teto de 1h."""
    return min(3600, (2 ** max(1, attempts)) * 5)


def recover_stale_outbox_claims(
    db: Session,
    *,
    stale_timeout_seconds: int = DEFAULT_STALE_TIMEOUT_SECONDS,
    restaurant_id: Optional[int] = None,
) -> int:
    """Recupera eventos que ficaram presos em 'processing' devido a crash ou interrupção do worker."""
    now = datetime.datetime.now(datetime.timezone.utc)
    cutoff = now - datetime.timedelta(seconds=stale_timeout_seconds)

    query = (
        db.query(IntegrationOutbox)
        .filter(
            IntegrationOutbox.status == "processing",
            or_(
                IntegrationOutbox.locked_at.is_(None),
                IntegrationOutbox.locked_at <= cutoff,
            ),
        )
    )
    if restaurant_id is not None:
        query = query.filter(IntegrationOutbox.restaurante_id == restaurant_id)

    stale_events = query.all()
    count = len(stale_events)
    if count > 0:
        for ev in stale_events:
            ev.status = "failed" if ev.attempts > 0 else "pending"
            ev.last_error = f"Stale claim recovered (locked > {stale_timeout_seconds}s)"
            ev.locked_at = None
            ev.locked_by = None
        db.commit()
        logger.warning("[OUTBOX RECOVERY] %d eventos presos em 'processing' foram recuperados para nova tentativa.", count)

    return count


def renew_outbox_claim_lease(
    db: Session,
    outbox_id: str,
    worker_id: Optional[str] = None,
) -> bool:
    """Renova atômica e imediatamente o lease do claim antes de disparar a requisição HTTP.

    Retorna True se o lease continua sob posse do worker_id e foi renovado para now().
    Retorna False se o claim expirou/foi recuperado por outro processo (evitando duplicatas).
    """
    now = datetime.datetime.now(datetime.timezone.utc)
    query = db.query(IntegrationOutbox).filter(
        IntegrationOutbox.id == outbox_id,
        IntegrationOutbox.status == "processing",
    )
    if worker_id is not None:
        query = query.filter(IntegrationOutbox.locked_by == worker_id)

    rows_affected = query.update({"locked_at": now}, synchronize_session=False)
    db.commit()
    return rows_affected > 0


def claim_outbox_batch(
    db: Session,
    *,
    batch_size: int = DEFAULT_BATCH_SIZE,
    worker_id: Optional[str] = None,
    restaurant_id: Optional[int] = None,
) -> list[dict[str, Any]]:
    """Fase 1: Transação atômica curta de claim com SKIP LOCKED e commit imediato.
    
    Garante que workers simultâneos recebam conjuntos estritamente disjuntos de eventos
    sem manter locks de linha do PostgreSQL durante as requisições HTTP de envio.
    """
    now = datetime.datetime.now(datetime.timezone.utc)
    wid = worker_id or f"worker-{uuid.uuid4().hex[:8]}"

    query = (
        db.query(IntegrationOutbox)
        .filter(
            IntegrationOutbox.status.in_(["pending", "failed"]),
            or_(
                IntegrationOutbox.next_retry_at.is_(None),
                IntegrationOutbox.next_retry_at <= now,
            ),
        )
    )
    if restaurant_id is not None:
        query = query.filter(IntegrationOutbox.restaurante_id == restaurant_id)

    query = query.order_by(IntegrationOutbox.created_at.asc()).limit(batch_size)

    try:
        events = query.with_for_update(skip_locked=True).all()
    except Exception:
        events = query.all()

    snapshots: list[dict[str, Any]] = []
    if not events:
        return snapshots

    for ev in events:
        snapshots.append({
            "id": ev.id,
            "restaurante_id": ev.restaurante_id,
            "event_id": ev.event_id,
            "event_name": ev.event_name,
            "aggregate_type": ev.aggregate_type,
            "aggregate_id": ev.aggregate_id,
            "payload": ev.payload,
            "attempts": ev.attempts,
            "max_attempts": ev.max_attempts,
            "locked_by": wid,
        })
        ev.status = "processing"
        ev.locked_at = now
        ev.locked_by = wid

    # Commit imediato do claim para liberar os locks de banco
    db.commit()
    return snapshots


def settle_outbox_event(
    db: Session,
    outbox_id: str,
    *,
    status: str,
    attempts: Optional[int] = None,
    next_retry_at: Optional[datetime.datetime] = None,
    response_status_code: Optional[int] = None,
    last_error: Optional[str] = None,
    worker_id: Optional[str] = None,
) -> bool:
    """Fase 3: Liquidação atômica e rápida do evento após a tentativa de entrega HTTP."""
    query = db.query(IntegrationOutbox).filter(IntegrationOutbox.id == outbox_id)
    if worker_id is not None:
        query = query.filter(IntegrationOutbox.locked_by == worker_id)

    record = query.first()
    if not record:
        logger.warning("[OUTBOX SETTLE] Registro %s não encontrado ou posse expirada ao liquidar.", outbox_id)
        return False

    now = datetime.datetime.now(datetime.timezone.utc)
    record.status = status
    record.locked_at = None
    record.locked_by = None
    record.last_error = last_error
    if response_status_code is not None:
        record.response_status_code = response_status_code
    if attempts is not None:
        record.attempts = attempts
    if next_retry_at is not None:
        record.next_retry_at = next_retry_at
    if status in {"delivered", "dead_letter"}:
        record.processed_at = now

    db.commit()
    return True


def dispatch_single_claimed_snapshot(
    db: Session,
    snapshot: dict[str, Any],
    *,
    client: Optional[httpx.Client] = None,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
) -> bool:
    """Fase 2: Envio HTTP executado completamente fora de qualquer lock de banco."""
    now = datetime.datetime.now(datetime.timezone.utc)
    rid = snapshot["restaurante_id"]
    outbox_id = snapshot["id"]
    worker_id = snapshot.get("locked_by")

    # Renova o lease atômico antes de iniciar a conexão HTTP.
    # Se o evento foi recuperado por timeout/crash durante a espera na fila local, aborta o disparo.
    if not renew_outbox_claim_lease(db, outbox_id, worker_id):
        logger.warning(
            "[OUTBOX LEASE ABORT] Claim %s não pertence mais ao worker %s ou expirou. Abortando envio duplicado.",
            outbox_id,
            worker_id,
        )
        return False

    config = (
        db.query(ConfiguracaoRestaurante)
        .filter(ConfiguracaoRestaurante.restaurante_id == rid)
        .first()
    )

    webhook_url = (config.webhook_url or "").strip() if config else ""
    webhook_secret = (config.webhook_secret or "").strip() if config else ""
    webhook_ativo = bool(config.webhook_ativo) if config else False

    # Se webhook inativo ou não configurado, consideramos entregue/ignorado
    if not webhook_ativo or not webhook_url:
        settle_outbox_event(
            db,
            outbox_id,
            status="delivered",
            last_error="Webhook inativo ou não configurado para o restaurante.",
            worker_id=worker_id,
        )
        return True

    payload_bytes = json.dumps(snapshot["payload"], ensure_ascii=False).encode("utf-8")
    headers = build_webhook_headers(
        secret=webhook_secret,
        payload_bytes=payload_bytes,
        event_id=snapshot["event_id"],
        event_name=snapshot["event_name"],
    )

    http_client = client or httpx.Client(timeout=timeout_seconds)
    close_client = client is None
    resp_code: Optional[int] = None

    try:
        response = http_client.post(webhook_url, content=payload_bytes, headers=headers)
        resp_code = response.status_code
        if 200 <= response.status_code < 300:
            settle_outbox_event(
                db,
                outbox_id,
                status="delivered",
                response_status_code=response.status_code,
                last_error=None,
                worker_id=worker_id,
            )
            return True
        else:
            raise RuntimeError(f"HTTP {response.status_code}: {response.text[:200]}")

    except Exception as exc:
        new_attempts = snapshot["attempts"] + 1
        max_attempts = snapshot["max_attempts"]

        if new_attempts >= max_attempts:
            logger.error(
                "[OUTBOX DEAD LETTER] Evento %s (%s) atingiu limite de %d tentativas: %s",
                snapshot["event_id"],
                snapshot["event_name"],
                max_attempts,
                exc,
            )
            settle_outbox_event(
                db,
                outbox_id,
                status="dead_letter",
                attempts=new_attempts,
                response_status_code=resp_code,
                last_error=str(exc)[:500],
                worker_id=worker_id,
            )
        else:
            delay = _calculate_backoff_seconds(new_attempts)
            next_retry = now + datetime.timedelta(seconds=delay)
            logger.warning(
                "[OUTBOX RETRY] Evento %s falhou (tentativa %d/%d). Próximo retry em %ds: %s",
                snapshot["event_id"],
                new_attempts,
                max_attempts,
                delay,
                exc,
            )
            settle_outbox_event(
                db,
                outbox_id,
                status="failed",
                attempts=new_attempts,
                next_retry_at=next_retry,
                response_status_code=resp_code,
                last_error=str(exc)[:500],
                worker_id=worker_id,
            )
        return False
    finally:
        if close_client:
            http_client.close()


def dispatch_single_outbox_event(
    db: Session,
    event_record: IntegrationOutbox,
    *,
    client: Optional[httpx.Client] = None,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
) -> bool:
    """Compatibilidade direta para envio de um registro existente."""
    now = datetime.datetime.now(datetime.timezone.utc)
    wid = event_record.locked_by or "direct-dispatcher"
    event_record.status = "processing"
    event_record.locked_at = now
    event_record.locked_by = wid
    db.commit()

    snapshot = {
        "id": event_record.id,
        "restaurante_id": event_record.restaurante_id,
        "event_id": event_record.event_id,
        "event_name": event_record.event_name,
        "aggregate_type": event_record.aggregate_type,
        "aggregate_id": event_record.aggregate_id,
        "payload": event_record.payload,
        "attempts": event_record.attempts,
        "max_attempts": event_record.max_attempts,
        "locked_by": wid,
    }
    result = dispatch_single_claimed_snapshot(db, snapshot, client=client, timeout_seconds=timeout_seconds)
    db.refresh(event_record)
    return result


def dispatch_pending_outbox_events(
    db: Session,
    *,
    batch_size: int = DEFAULT_BATCH_SIZE,
    worker_id: Optional[str] = None,
    stale_timeout_seconds: int = DEFAULT_STALE_TIMEOUT_SECONDS,
    client: Optional[httpx.Client] = None,
    restaurant_id: Optional[int] = None,
) -> dict[str, int]:
    """Fluxo completo de processamento: recuperação de stale claims -> claim atômico -> envio desacoplado."""
    stats = {
        "claimed": 0,
        "delivered": 0,
        "failed": 0,
        "dead_letter": 0,
        "recovered_stale": 0,
        "total": 0,
    }

    # 1. Recupera claims abandonados/stale antes do próximo ciclo
    recovered = recover_stale_outbox_claims(
        db,
        stale_timeout_seconds=stale_timeout_seconds,
        restaurant_id=restaurant_id,
    )
    stats["recovered_stale"] = recovered

    # 2. Reivindica lote exclusivo e comita o lock de linha
    claimed_snapshots = claim_outbox_batch(
        db,
        batch_size=batch_size,
        worker_id=worker_id,
        restaurant_id=restaurant_id,
    )
    stats["claimed"] = len(claimed_snapshots)
    stats["total"] = len(claimed_snapshots)

    if not claimed_snapshots:
        return stats

    # 3. Dispara cada snapshot fora de locks de banco
    for snapshot in claimed_snapshots:
        success = dispatch_single_claimed_snapshot(
            db,
            snapshot,
            client=client,
        )
        if success:
            stats["delivered"] += 1
        else:
            # Verifica se o evento caiu em dead_letter ou failed
            ev = db.query(IntegrationOutbox).filter(IntegrationOutbox.id == snapshot["id"]).first()
            if ev and ev.status == "dead_letter":
                stats["dead_letter"] += 1
            else:
                stats["failed"] += 1

    return stats
