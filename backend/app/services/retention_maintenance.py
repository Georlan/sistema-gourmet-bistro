"""Rotinas de retenção e expurgo incremental para crescimento sustentável do KÔMA.

Diretrizes arquiteturais:
- Isolamento estrito por tenant: cada rotina opera sob `restaurante_id`.
- Modos dry-run (padrão) e lote limitado (`batch_size` máx. 500): nunca trava tabelas.
- Preservação incondicional:
  - Pedidos (`comandas`, `lancamentos`, `itens`), pagamentos (`pagamentos`, `caixa_*`),
    conciliações financeiras, auditoria fiscal (`fiscal_*`) e chaves de idempotência ativas
    NUNCA são removidos.
  - Chat de pedidos (`order_chat_retention`): mantido desligado por padrão
    (`ORDER_CHAT_RETENTION_ENABLED=false`).
- Desligado por padrão em produção (opt-in estrito via env var `KOMA_RETENTION_MAINTENANCE_ENABLED=true`
  ou argumento explícito `enable_opt_in=True`). Sem workers permanentes pagos.
"""

from __future__ import annotations

import datetime
import logging
import os
from dataclasses import asdict, dataclass
from typing import Any

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from ..database import require_tenant_id
from ..models import (
    CustomerRegistrationChallenge,
    IntegrationOutbox,
    NotificacaoWhatsApp,
    PrintJob,
)
from ..support_models import SupportSession
from ..timezone_utils import get_utc_now

logger = logging.getLogger("koma.retention_maintenance")

DEFAULT_BATCH_SIZE = 500
MAX_BATCH_SIZE = 1000

ENV_RETENTION_ENABLED = "KOMA_RETENTION_MAINTENANCE_ENABLED"


@dataclass(frozen=True)
class TenantRetentionReport:
    restaurante_id: int
    dry_run: bool
    opt_in_active: bool
    executed_at: str
    outbox_candidates: int
    outbox_purged: int
    print_jobs_candidates: int
    print_jobs_purged: int
    challenges_candidates: int
    challenges_purged: int
    notifications_candidates: int
    notifications_purged: int
    support_sessions_candidates: int
    support_sessions_purged: int

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def is_retention_maintenance_enabled() -> bool:
    """Verifica se a manutenção destrutiva de expurgo está explicitamente habilitada."""
    return os.getenv(ENV_RETENTION_ENABLED, "false").strip().lower() == "true"


def purge_delivered_outbox_events(
    db: Session,
    *,
    restaurante_id: int,
    retention_days: int = 30,
    batch_size: int = DEFAULT_BATCH_SIZE,
    dry_run: bool = True,
    now: datetime.datetime | None = None,
) -> tuple[int, int]:
    """Expurga eventos do transactional outbox já entregues além do período de retenção.

    Apenas eventos em status terminal 'delivered' com processed_at anterior ao corte.
    Eventos 'pending', 'processing', 'failed' e 'dead_letter' são preservados intactos.
    """
    effective_now = now or get_utc_now()
    cutoff = effective_now - datetime.timedelta(days=max(7, retention_days))
    eff_batch = min(MAX_BATCH_SIZE, max(1, batch_size))

    candidate_ids = (
        db.query(IntegrationOutbox.id)
        .filter(
            IntegrationOutbox.restaurante_id == restaurante_id,
            IntegrationOutbox.status == "delivered",
            IntegrationOutbox.processed_at.isnot(None),
            IntegrationOutbox.processed_at < cutoff,
        )
        .order_by(IntegrationOutbox.processed_at.asc(), IntegrationOutbox.id.asc())
        .limit(eff_batch)
        .all()
    )
    ids_to_purge = [r[0] for r in candidate_ids]
    candidate_count = len(ids_to_purge)

    if dry_run or candidate_count == 0:
        return candidate_count, 0

    purged = (
        db.query(IntegrationOutbox)
        .filter(
            IntegrationOutbox.restaurante_id == restaurante_id,
            IntegrationOutbox.id.in_(ids_to_purge),
            IntegrationOutbox.status == "delivered",
        )
        .delete(synchronize_session=False)
    )
    return candidate_count, purged


def purge_completed_print_jobs(
    db: Session,
    *,
    restaurante_id: int,
    retention_days: int = 14,
    batch_size: int = DEFAULT_BATCH_SIZE,
    dry_run: bool = True,
    now: datetime.datetime | None = None,
) -> tuple[int, int]:
    """Expurga jobs de impressão concluídos ('printed') mais antigos que a retenção.

    Jobs 'pending', 'claimed' e 'printing' NUNCA são removidos.
    Preserva chaves de idempotência recentes para evitar impressões duplicadas.
    """
    effective_now = now or get_utc_now()
    cutoff = effective_now - datetime.timedelta(days=max(3, retention_days))
    eff_batch = min(MAX_BATCH_SIZE, max(1, batch_size))

    candidate_ids = (
        db.query(PrintJob.id)
        .filter(
            PrintJob.restaurante_id == restaurante_id,
            PrintJob.status == "printed",
            or_(
                and_(PrintJob.printed_at.isnot(None), PrintJob.printed_at < cutoff),
                and_(PrintJob.printed_at.is_(None), PrintJob.created_at < cutoff),
            ),
        )
        .order_by(PrintJob.created_at.asc(), PrintJob.id.asc())
        .limit(eff_batch)
        .all()
    )
    ids_to_purge = [r[0] for r in candidate_ids]
    candidate_count = len(ids_to_purge)

    if dry_run or candidate_count == 0:
        return candidate_count, 0

    purged = (
        db.query(PrintJob)
        .filter(
            PrintJob.restaurante_id == restaurante_id,
            PrintJob.id.in_(ids_to_purge),
            PrintJob.status == "printed",
        )
        .delete(synchronize_session=False)
    )
    return candidate_count, purged


def purge_expired_customer_challenges(
    db: Session,
    *,
    restaurante_id: int,
    grace_hours: int = 24,
    batch_size: int = DEFAULT_BATCH_SIZE,
    dry_run: bool = True,
    now: datetime.datetime | None = None,
) -> tuple[int, int]:
    """Remove desafios de registro e validação de email de clientes já expirados."""
    effective_now = now or get_utc_now()
    cutoff = effective_now - datetime.timedelta(hours=max(1, grace_hours))
    eff_batch = min(MAX_BATCH_SIZE, max(1, batch_size))

    candidate_ids = (
        db.query(CustomerRegistrationChallenge.id)
        .filter(
            CustomerRegistrationChallenge.restaurante_id == restaurante_id,
            CustomerRegistrationChallenge.expira_em < cutoff,
        )
        .order_by(CustomerRegistrationChallenge.expira_em.asc())
        .limit(eff_batch)
        .all()
    )
    ids_to_purge = [r[0] for r in candidate_ids]
    candidate_count = len(ids_to_purge)

    if dry_run or candidate_count == 0:
        return candidate_count, 0

    purged = (
        db.query(CustomerRegistrationChallenge)
        .filter(
            CustomerRegistrationChallenge.restaurante_id == restaurante_id,
            CustomerRegistrationChallenge.id.in_(ids_to_purge),
        )
        .delete(synchronize_session=False)
    )
    return candidate_count, purged


def purge_delivered_whatsapp_notifications(
    db: Session,
    *,
    restaurante_id: int,
    retention_days: int = 60,
    batch_size: int = DEFAULT_BATCH_SIZE,
    dry_run: bool = True,
    now: datetime.datetime | None = None,
) -> tuple[int, int]:
    """Expurga notificações WhatsApp já lidas ou entregues após 60 dias de retenção.

    Notificações pendentes, erros recentes e registros sem confirmação são preservados.
    """
    effective_now = now or get_utc_now()
    cutoff = effective_now - datetime.timedelta(days=max(30, retention_days))
    eff_batch = min(MAX_BATCH_SIZE, max(1, batch_size))

    candidate_ids = (
        db.query(NotificacaoWhatsApp.id)
        .filter(
            NotificacaoWhatsApp.restaurante_id == restaurante_id,
            NotificacaoWhatsApp.status.in_(("read", "delivered")),
            NotificacaoWhatsApp.created_at < cutoff,
        )
        .order_by(NotificacaoWhatsApp.created_at.asc(), NotificacaoWhatsApp.id.asc())
        .limit(eff_batch)
        .all()
    )
    ids_to_purge = [r[0] for r in candidate_ids]
    candidate_count = len(ids_to_purge)

    if dry_run or candidate_count == 0:
        return candidate_count, 0

    purged = (
        db.query(NotificacaoWhatsApp)
        .filter(
            NotificacaoWhatsApp.restaurante_id == restaurante_id,
            NotificacaoWhatsApp.id.in_(ids_to_purge),
            NotificacaoWhatsApp.status.in_(("read", "delivered")),
        )
        .delete(synchronize_session=False)
    )
    return candidate_count, purged


def purge_expired_support_sessions(
    db: Session,
    *,
    restaurante_id: int,
    retention_days: int = 30,
    batch_size: int = DEFAULT_BATCH_SIZE,
    dry_run: bool = True,
    now: datetime.datetime | None = None,
) -> tuple[int, int]:
    """Remove sessões de suporte administrativo já finalizadas e expiradas há mais de 30 dias."""
    effective_now = now or get_utc_now()
    cutoff = effective_now - datetime.timedelta(days=max(7, retention_days))
    eff_batch = min(MAX_BATCH_SIZE, max(1, batch_size))

    candidate_ids = (
        db.query(SupportSession.id)
        .filter(
            SupportSession.restaurante_id == restaurante_id,
            SupportSession.status.in_(("ended", "expired")),
            SupportSession.expires_at < cutoff,
        )
        .order_by(SupportSession.expires_at.asc())
        .limit(eff_batch)
        .all()
    )
    ids_to_purge = [r[0] for r in candidate_ids]
    candidate_count = len(ids_to_purge)

    if dry_run or candidate_count == 0:
        return candidate_count, 0

    purged = (
        db.query(SupportSession)
        .filter(
            SupportSession.restaurante_id == restaurante_id,
            SupportSession.id.in_(ids_to_purge),
            SupportSession.status.in_(("ended", "expired")),
        )
        .delete(synchronize_session=False)
    )
    return candidate_count, purged


def run_tenant_retention_maintenance(
    db: Session,
    *,
    restaurante_id: int | None = None,
    dry_run: bool = True,
    batch_size: int = DEFAULT_BATCH_SIZE,
    enable_opt_in: bool = False,
    now: datetime.datetime | None = None,
) -> TenantRetentionReport:
    """Executa a rotina de manutenção e retenção com garantias rigorosas.

    - Falha fechada: dry_run é forçado a True se enable_opt_in não for explícito
      e a variável de ambiente KOMA_RETENTION_MAINTENANCE_ENABLED não estiver ativa.
    - Tenant-scoped: restaurante_id é obrigatório.
    - Idempotente: pode ser chamada repetidamente sem efeitos colaterais imprevistos.
    """
    target_tenant = int(restaurante_id if restaurante_id is not None else require_tenant_id())
    opt_in_active = enable_opt_in or is_retention_maintenance_enabled()
    effective_dry_run = True if not opt_in_active else bool(dry_run)

    effective_now = now or get_utc_now()

    outbox_cand, outbox_del = purge_delivered_outbox_events(
        db,
        restaurante_id=target_tenant,
        batch_size=batch_size,
        dry_run=effective_dry_run,
        now=effective_now,
    )
    print_cand, print_del = purge_completed_print_jobs(
        db,
        restaurante_id=target_tenant,
        batch_size=batch_size,
        dry_run=effective_dry_run,
        now=effective_now,
    )
    chal_cand, chal_del = purge_expired_customer_challenges(
        db,
        restaurante_id=target_tenant,
        batch_size=batch_size,
        dry_run=effective_dry_run,
        now=effective_now,
    )
    notif_cand, notif_del = purge_delivered_whatsapp_notifications(
        db,
        restaurante_id=target_tenant,
        batch_size=batch_size,
        dry_run=effective_dry_run,
        now=effective_now,
    )
    sess_cand, sess_del = purge_expired_support_sessions(
        db,
        restaurante_id=target_tenant,
        batch_size=batch_size,
        dry_run=effective_dry_run,
        now=effective_now,
    )

    if not effective_dry_run:
        db.commit()

    report = TenantRetentionReport(
        restaurante_id=target_tenant,
        dry_run=effective_dry_run,
        opt_in_active=opt_in_active,
        executed_at=effective_now.isoformat(),
        outbox_candidates=outbox_cand,
        outbox_purged=outbox_del,
        print_jobs_candidates=print_cand,
        print_jobs_purged=print_del,
        challenges_candidates=chal_cand,
        challenges_purged=chal_del,
        notifications_candidates=notif_cand,
        notifications_purged=notif_del,
        support_sessions_candidates=sess_cand,
        support_sessions_purged=sess_del,
    )
    logger.info(
        "[RETENTION MAINTENANCE] Tenant %d: dry_run=%s, cand=(outbox:%d, print:%d, chal:%d, notif:%d, sess:%d), purged=(outbox:%d, print:%d, chal:%d, notif:%d, sess:%d)",
        target_tenant,
        effective_dry_run,
        outbox_cand,
        print_cand,
        chal_cand,
        notif_cand,
        sess_cand,
        outbox_del,
        print_del,
        chal_del,
        notif_del,
        sess_del,
    )
    return report
