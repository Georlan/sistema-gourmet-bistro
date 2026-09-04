import datetime
import logging
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..database import tenant_session_scope
from ..models import (
    IntegrationOutbox,
    OnlinePaymentIntent,
    OnlinePaymentWebhookEvent,
    PrintAgentToken,
    PrintJob,
    RestaurantPaymentAccount,
    Restaurante,
    SuperAdminAuditLog,
    Usuario,
)
from .outbox.dispatcher import recover_stale_outbox_claims

logger = logging.getLogger("koma.services.incident_service")


class IncidentSeverity(str, Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"


class IncidentSource(str, Enum):
    OUTBOX = "outbox"
    MERCADO_PAGO = "mercado_pago"
    IMPRESSAO = "impressao"
    ACESSO = "acesso"
    TENANT = "tenant"


class IncidentItem(BaseModel):
    id: str
    tenant_id: int
    tenant_name: str
    source: IncidentSource
    severity: IncidentSeverity
    title: str
    detail: str
    evidence: Dict[str, Any]
    detected_at: str
    last_seen_at: Optional[str] = None
    recommended_action: str
    action_available: bool = False
    action_type: Optional[str] = None
    action_target_id: Optional[str] = None


SEVERITY_ORDER = {
    IncidentSeverity.CRITICAL: 0,
    IncidentSeverity.HIGH: 1,
    IncidentSeverity.MEDIUM: 2,
    IncidentSeverity.LOW: 3,
    IncidentSeverity.INFO: 4,
}


def diagnose_all_incidents(
    db: Session,
    *,
    filter_tenant_id: Optional[int] = None,
    filter_source: Optional[str] = None,
    filter_severity: Optional[str] = None,
) -> List[IncidentItem]:
    """Diagnostica e agrega incidentes reais de todas as fontes operacionais do KÔMA.

    Nenhum dado é mockado ou inventado. Se o subsistema estiver sem anomalias,
    nenhum incidente será gerado para ele.
    """
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    incidents: List[IncidentItem] = []

    # Mapeamento de estabelecimentos
    tenants_query = db.query(Restaurante)
    if filter_tenant_id is not None:
        tenants_query = tenants_query.filter(Restaurante.id == filter_tenant_id)
    tenants_map = {r.id: r for r in tenants_query.all()}

    if not tenants_map:
        return []

    tenant_ids = list(tenants_map.keys())

    # 1. OUTBOX: Eventos com falha, dead-letter, claims stale ou represamento
    if not filter_source or filter_source == IncidentSource.OUTBOX.value:
        stale_cutoff = now_utc - datetime.timedelta(minutes=5)
        backlog_cutoff = now_utc - datetime.timedelta(minutes=15)

        outbox_events = (
            db.query(IntegrationOutbox)
            .filter(
                IntegrationOutbox.restaurante_id.in_(tenant_ids),
                or_(
                    IntegrationOutbox.status.in_(["failed", "dead_letter"]),
                    (
                        (IntegrationOutbox.status == "processing")
                        & or_(
                            IntegrationOutbox.locked_at.is_(None),
                            IntegrationOutbox.locked_at <= stale_cutoff,
                        )
                    ),
                    (
                        (IntegrationOutbox.status == "pending")
                        & (IntegrationOutbox.created_at <= backlog_cutoff)
                    ),
                ),
            )
            .order_by(IntegrationOutbox.created_at.desc())
            .limit(100)
            .all()
        )

        for ev in outbox_events:
            tenant = tenants_map.get(ev.restaurante_id)
            tenant_name = tenant.nome if tenant else f"Tenant #{ev.restaurante_id}"

            if ev.status in ("failed", "dead_letter"):
                is_critical = ev.attempts >= (ev.max_attempts or 5)
                sev = IncidentSeverity.CRITICAL if is_critical else IncidentSeverity.HIGH
                incidents.append(
                    IncidentItem(
                        id=f"outbox_failed_{ev.id}",
                        tenant_id=ev.restaurante_id,
                        tenant_name=tenant_name,
                        source=IncidentSource.OUTBOX,
                        severity=sev,
                        title=f"Outbox: evento {ev.status} ({ev.event_name})",
                        detail=f"Evento '{ev.event_name}' (agregado {ev.aggregate_type} #{ev.aggregate_id}) falhou após {ev.attempts} tentativas: {ev.last_error or 'Erro não detalhado'}.",
                        evidence={
                            "outbox_id": ev.id,
                            "event_id": ev.event_id,
                            "event_name": ev.event_name,
                            "aggregate_type": ev.aggregate_type,
                            "aggregate_id": ev.aggregate_id,
                            "attempts": ev.attempts,
                            "max_attempts": ev.max_attempts,
                            "last_error": ev.last_error,
                            "status": ev.status,
                            "response_status_code": ev.response_status_code,
                        },
                        detected_at=ev.created_at.isoformat() if ev.created_at else now_utc.isoformat(),
                        last_seen_at=ev.processed_at.isoformat() if ev.processed_at else None,
                        recommended_action="Reprocessar evento para restabelecer sincronização com integração externa.",
                        action_available=True,
                        action_type="reprocess_outbox_event",
                        action_target_id=ev.id,
                    )
                )
            elif ev.status == "processing":
                incidents.append(
                    IncidentItem(
                        id=f"outbox_stale_{ev.id}",
                        tenant_id=ev.restaurante_id,
                        tenant_name=tenant_name,
                        source=IncidentSource.OUTBOX,
                        severity=IncidentSeverity.MEDIUM,
                        title=f"Outbox: claim stale em '{ev.event_name}'",
                        detail=f"Evento bloqueado pelo worker '{ev.locked_by or 'desconhecido'}' há mais de 5 minutos sem conclusão.",
                        evidence={
                            "outbox_id": ev.id,
                            "event_id": ev.event_id,
                            "locked_by": ev.locked_by,
                            "locked_at": ev.locked_at.isoformat() if ev.locked_at else None,
                            "attempts": ev.attempts,
                        },
                        detected_at=ev.locked_at.isoformat() if ev.locked_at else now_utc.isoformat(),
                        recommended_action="Liberar claim stale para permitir nova tentativa de envio.",
                        action_available=True,
                        action_type="reclaim_outbox_stale",
                        action_target_id=str(ev.restaurante_id),
                    )
                )
            elif ev.status == "pending":
                incidents.append(
                    IncidentItem(
                        id=f"outbox_delayed_{ev.id}",
                        tenant_id=ev.restaurante_id,
                        tenant_name=tenant_name,
                        source=IncidentSource.OUTBOX,
                        severity=IncidentSeverity.LOW,
                        title=f"Outbox: evento pendente atrasado ({ev.event_name})",
                        detail=f"Evento gerado há mais de 15 minutos aguardando processamento do worker.",
                        evidence={
                            "outbox_id": ev.id,
                            "event_id": ev.event_id,
                            "created_at": ev.created_at.isoformat() if ev.created_at else None,
                            "next_retry_at": ev.next_retry_at.isoformat() if ev.next_retry_at else None,
                        },
                        detected_at=ev.created_at.isoformat() if ev.created_at else now_utc.isoformat(),
                        recommended_action="Reprocessar imediatamente o lote do outbox.",
                        action_available=True,
                        action_type="reprocess_outbox_event",
                        action_target_id=ev.id,
                    )
                )

    # 2. MERCADO PAGO / PAGAMENTOS ONLINE: Webhooks com falha e contas desconectadas
    if not filter_source or filter_source == IncidentSource.MERCADO_PAGO.value:
        failed_webhooks = (
            db.query(OnlinePaymentWebhookEvent)
            .filter(
                OnlinePaymentWebhookEvent.restaurante_id.in_(tenant_ids),
                OnlinePaymentWebhookEvent.status == "failed",
            )
            .order_by(OnlinePaymentWebhookEvent.received_at.desc())
            .limit(50)
            .all()
        )
        for wh in failed_webhooks:
            tenant = tenants_map.get(wh.restaurante_id)
            tenant_name = tenant.nome if tenant else f"Tenant #{wh.restaurante_id}"
            incidents.append(
                IncidentItem(
                    id=f"mp_webhook_failed_{wh.id}",
                    tenant_id=wh.restaurante_id,
                    tenant_name=tenant_name,
                    source=IncidentSource.MERCADO_PAGO,
                    severity=IncidentSeverity.HIGH,
                    title="Mercado Pago: falha ao processar notificação de webhook",
                    detail=f"Webhook para pagamento externo '{wh.external_payment_id}' falhou: {wh.last_error or 'Erro interno'}.",
                    evidence={
                        "webhook_id": wh.id,
                        "request_id": wh.request_id,
                        "external_payment_id": wh.external_payment_id,
                        "provider": wh.provider,
                        "received_at": wh.received_at.isoformat() if wh.received_at else None,
                        "last_error": wh.last_error,
                    },
                    detected_at=wh.received_at.isoformat() if wh.received_at else now_utc.isoformat(),
                    last_seen_at=wh.processed_at.isoformat() if wh.processed_at else None,
                    recommended_action="Reconciliar o pagamento correspondente com base no ID externo.",
                    action_available=False,
                )
            )

        payment_accounts = (
            db.query(RestaurantPaymentAccount)
            .filter(
                RestaurantPaymentAccount.restaurante_id.in_(tenant_ids),
                RestaurantPaymentAccount.provider == "mercado_pago",
                RestaurantPaymentAccount.status.in_(["error", "disconnected"]),
            )
            .all()
        )
        for acc in payment_accounts:
            tenant = tenants_map.get(acc.restaurante_id)
            tenant_name = tenant.nome if tenant else f"Tenant #{acc.restaurante_id}"
            sev = IncidentSeverity.HIGH if acc.status == "error" else IncidentSeverity.MEDIUM
            incidents.append(
                IncidentItem(
                    id=f"mp_account_status_{acc.id}",
                    tenant_id=acc.restaurante_id,
                    tenant_name=tenant_name,
                    source=IncidentSource.MERCADO_PAGO,
                    severity=sev,
                    title=f"Mercado Pago: conta em estado '{acc.status}'",
                    detail=f"A conexão com o Mercado Pago para o restaurante '{tenant_name}' está '{acc.status}'. Pagamentos Pix online estão indisponíveis.",
                    evidence={
                        "account_id": acc.id,
                        "provider": acc.provider,
                        "status": acc.status,
                        "live_mode": acc.live_mode,
                        "updated_at": acc.updated_at.isoformat() if acc.updated_at else None,
                    },
                    detected_at=acc.updated_at.isoformat() if acc.updated_at else now_utc.isoformat(),
                    recommended_action="Solicitar reconexão OAuth da conta Mercado Pago nas configurações do caixa.",
                    action_available=False,
                )
            )

    # 3. IMPRESSÃO: PrintJobs com falha, retidos ou agentes offline
    if not filter_source or filter_source == IncidentSource.IMPRESSAO.value:
        print_stale_cutoff = now_utc - datetime.timedelta(minutes=15)
        failed_or_delayed_jobs = (
            db.query(PrintJob)
            .filter(
                PrintJob.restaurante_id.in_(tenant_ids),
                or_(
                    PrintJob.status == "failed",
                    (
                        (PrintJob.status == "pending")
                        & (PrintJob.created_at <= print_stale_cutoff)
                    ),
                ),
            )
            .order_by(PrintJob.created_at.desc())
            .limit(50)
            .all()
        )
        for pj in failed_or_delayed_jobs:
            tenant = tenants_map.get(pj.restaurante_id)
            tenant_name = tenant.nome if tenant else f"Tenant #{pj.restaurante_id}"

            if pj.status == "failed":
                incidents.append(
                    IncidentItem(
                        id=f"print_job_failed_{pj.id}",
                        tenant_id=pj.restaurante_id,
                        tenant_name=tenant_name,
                        source=IncidentSource.IMPRESSAO,
                        severity=IncidentSeverity.HIGH,
                        title=f"Impressão: documento de {pj.document_type} falhou",
                        detail=f"Comanda/pedido '{pj.source_type} #{pj.source_id}' com destino '{pj.destination}' falhou após {pj.attempts} tentativas: {pj.last_error or 'Falha de comunicação com impressora'}.",
                        evidence={
                            "job_id": pj.id,
                            "document_type": pj.document_type,
                            "destination": pj.destination,
                            "source_type": pj.source_type,
                            "source_id": pj.source_id,
                            "attempts": pj.attempts,
                            "last_error": pj.last_error,
                            "printer_name": pj.printer_name,
                            "agent_id": pj.agent_id,
                        },
                        detected_at=pj.created_at.isoformat() if pj.created_at else now_utc.isoformat(),
                        recommended_action="Reenviar documento para a fila de impressão.",
                        action_available=True,
                        action_type="retry_print_job",
                        action_target_id=pj.id,
                    )
                )
            elif pj.status == "pending":
                incidents.append(
                    IncidentItem(
                        id=f"print_job_delayed_{pj.id}",
                        tenant_id=pj.restaurante_id,
                        tenant_name=tenant_name,
                        source=IncidentSource.IMPRESSAO,
                        severity=IncidentSeverity.MEDIUM,
                        title=f"Impressão: documento retido na fila ({pj.document_type})",
                        detail=f"Documento para '{pj.destination}' aguarda impressão há mais de 15 minutos.",
                        evidence={
                            "job_id": pj.id,
                            "document_type": pj.document_type,
                            "destination": pj.destination,
                            "source_id": pj.source_id,
                            "created_at": pj.created_at.isoformat() if pj.created_at else None,
                        },
                        detected_at=pj.created_at.isoformat() if pj.created_at else now_utc.isoformat(),
                        recommended_action="Verificar status do agente de impressão ou reenviar documento.",
                        action_available=True,
                        action_type="retry_print_job",
                        action_target_id=pj.id,
                    )
                )

        agent_heartbeat_cutoff = now_utc - datetime.timedelta(minutes=10)
        stale_agents = (
            db.query(PrintAgentToken)
            .filter(
                PrintAgentToken.restaurante_id.in_(tenant_ids),
                PrintAgentToken.ativo.is_(True),
                or_(
                    PrintAgentToken.last_seen_at.is_(None),
                    PrintAgentToken.last_seen_at <= agent_heartbeat_cutoff,
                ),
            )
            .all()
        )
        for ag in stale_agents:
            tenant = tenants_map.get(ag.restaurante_id)
            tenant_name = tenant.nome if tenant else f"Tenant #{ag.restaurante_id}"
            incidents.append(
                IncidentItem(
                    id=f"print_agent_offline_{ag.id}",
                    tenant_id=ag.restaurante_id,
                    tenant_name=tenant_name,
                    source=IncidentSource.IMPRESSAO,
                    severity=IncidentSeverity.HIGH,
                    title=f"Impressão: Print Agent '{ag.agent_id}' sem heartbeat",
                    detail=f"O agente de impressão '{ag.agent_id}' está ativo mas não envia heartbeat há mais de 10 minutos.",
                    evidence={
                        "token_id": ag.id,
                        "agent_id": ag.agent_id,
                        "ativo": ag.ativo,
                        "last_seen_at": ag.last_seen_at.isoformat() if ag.last_seen_at else None,
                        "created_at": ag.created_at.isoformat() if ag.created_at else None,
                    },
                    detected_at=ag.last_seen_at.isoformat() if ag.last_seen_at else (ag.created_at.isoformat() if ag.created_at else now_utc.isoformat()),
                    recommended_action="Certificar que o aplicativo Print Agent está em execução na máquina de impressão.",
                    action_available=False,
                )
            )

    # 4. ACESSO E EQUIPE: Tenants sem administrador ou sem nenhum usuário ativo
    if not filter_source or filter_source == IncidentSource.ACESSO.value:
        for tenant_id, tenant in tenants_map.items():
            if getattr(tenant, "saas_status", "active") == "suspended":
                continue

            users = (
                db.query(Usuario)
                .filter(Usuario.restaurante_id == tenant_id)
                .all()
            )
            active_users = [u for u in users if str(u.status or "").lower().strip() == "ativo"]
            active_admins = [
                u for u in active_users
                if (str(u.role or u.cargo or "").lower().strip() in ("admin", "superadmin"))
            ]

            if not active_users:
                incidents.append(
                    IncidentItem(
                        id=f"access_no_users_{tenant_id}",
                        tenant_id=tenant_id,
                        tenant_name=tenant.nome,
                        source=IncidentSource.ACESSO,
                        severity=IncidentSeverity.CRITICAL,
                        title="Acesso: restaurante sem nenhum usuário ativo",
                        detail=f"O estabelecimento '{tenant.nome}' possui {len(users)} usuário(s) cadastrado(s), mas nenhum com status ativo.",
                        evidence={
                            "total_users": len(users),
                            "active_users": 0,
                            "pending_or_inactive": len(users),
                        },
                        detected_at=tenant.created_at.isoformat() if hasattr(tenant, "created_at") and tenant.created_at else now_utc.isoformat(),
                        recommended_action="Criar ou ativar um usuário na aba Acessos e equipe.",
                        action_available=False,
                    )
                )
            elif not active_admins:
                incidents.append(
                    IncidentItem(
                        id=f"access_no_admin_{tenant_id}",
                        tenant_id=tenant_id,
                        tenant_name=tenant.nome,
                        source=IncidentSource.ACESSO,
                        severity=IncidentSeverity.HIGH,
                        title="Acesso: restaurante sem administrador ativo",
                        detail=f"O estabelecimento '{tenant.nome}' possui {len(active_users)} usuário(s) ativo(s), mas nenhum possui cargo de 'admin'.",
                        evidence={
                            "active_users": len(active_users),
                            "active_admins": 0,
                            "roles_present": list(set(str(u.role or u.cargo or "garcom") for u in active_users)),
                        },
                        detected_at=now_utc.isoformat(),
                        recommended_action="Promover ao menos um operador ao cargo de 'admin' na aba Acessos e equipe.",
                        action_available=False,
                    )
                )

    # 5. TENANT / SAAS STATUS: Tenants suspensos
    if not filter_source or filter_source == IncidentSource.TENANT.value:
        for tenant_id, tenant in tenants_map.items():
            if getattr(tenant, "saas_status", "active") == "suspended":
                incidents.append(
                    IncidentItem(
                        id=f"tenant_suspended_{tenant_id}",
                        tenant_id=tenant_id,
                        tenant_name=tenant.nome,
                        source=IncidentSource.TENANT,
                        severity=IncidentSeverity.MEDIUM,
                        title=f"Tenant: estabelecimento '{tenant.nome}' suspenso",
                        detail="O acesso operacional e o cardápio público estão bloqueados devido a suspensão SaaS.",
                        evidence={
                            "tenant_id": tenant.id,
                            "saas_status": tenant.saas_status,
                            "subdomain": getattr(tenant, "subdomain", None),
                        },
                        detected_at=now_utc.isoformat(),
                        recommended_action="Reativar o estabelecimento na aba Restaurantes após regularização comercial.",
                        action_available=False,
                    )
                )

    if filter_severity:
        incidents = [inc for inc in incidents if inc.severity.value == filter_severity]

    incidents.sort(
        key=lambda inc: (SEVERITY_ORDER.get(inc.severity, 99), inc.detected_at),
        reverse=False,
    )

    return incidents


def execute_incident_action(
    db: Session,
    *,
    action_type: str,
    target_id: str,
    reason: str,
    operator: str,
) -> Dict[str, Any]:
    """Executa ação de recuperação canônica e auditada sobre um incidente."""
    clean_reason = reason.strip()
    now_utc = datetime.datetime.now(datetime.timezone.utc)

    if action_type == "reprocess_outbox_event":
        event = db.query(IntegrationOutbox).filter(IntegrationOutbox.id == target_id).first()
        if not event:
            raise ValueError(f"Evento do outbox '{target_id}' não encontrado.")

        tenant_id = event.restaurante_id
        old_status = event.status
        event.status = "pending"
        event.attempts = 0
        event.next_retry_at = now_utc
        event.locked_at = None
        event.locked_by = None
        event.last_error = f"Reprocessamento solicitado por {operator}: {clean_reason}"

        audit = SuperAdminAuditLog(
            restaurante_id=tenant_id,
            actor=operator,
            action="SUPERADMIN_INCIDENT_REPROCESS_OUTBOX",
            reason=clean_reason,
            after_data={
                "outbox_id": event.id,
                "event_id": event.event_id,
                "event_name": event.event_name,
                "previous_status": old_status,
            },
        )
        db.add(audit)
        db.commit()

        logger.info(
            "Evento do outbox %s (tenant=%s) reprocessado pelo operador %s",
            event.id,
            tenant_id,
            operator,
        )
        return {
            "success": True,
            "action": action_type,
            "target_id": target_id,
            "message": f"Evento '{event.event_name}' agendado para reprocessamento imediato.",
        }

    elif action_type == "reclaim_outbox_stale":
        try:
            tenant_id = int(target_id)
        except ValueError:
            raise ValueError(f"ID de tenant inválido: {target_id}")

        recovered_count = recover_stale_outbox_claims(
            db,
            stale_timeout_seconds=60,
            restaurant_id=tenant_id,
        )

        audit = SuperAdminAuditLog(
            restaurante_id=tenant_id,
            actor=operator,
            action="SUPERADMIN_INCIDENT_RECLAIM_STALE_OUTBOX",
            reason=clean_reason,
            after_data={
                "recovered_count": recovered_count,
            },
        )
        db.add(audit)
        db.commit()

        logger.info(
            "Recuperados %d eventos stale do outbox para tenant %s por %s",
            recovered_count,
            tenant_id,
            operator,
        )
        return {
            "success": True,
            "action": action_type,
            "target_id": target_id,
            "recovered_count": recovered_count,
            "message": f"{recovered_count} evento(s) travado(s) liberado(s) com sucesso.",
        }

    elif action_type == "retry_print_job":
        job = db.query(PrintJob).filter(PrintJob.id == target_id).first()
        if not job:
            raise ValueError(f"Job de impressão '{target_id}' não encontrado.")

        tenant_id = job.restaurante_id
        old_status = job.status
        job.status = "pending"
        job.attempts = 0
        job.agent_id = None
        job.printer_name = None
        job.claimed_at = None
        job.printed_at = None
        job.last_error = None

        audit = SuperAdminAuditLog(
            restaurante_id=tenant_id,
            actor=operator,
            action="SUPERADMIN_INCIDENT_RETRY_PRINT_JOB",
            reason=clean_reason,
            after_data={
                "job_id": job.id,
                "document_type": job.document_type,
                "destination": job.destination,
                "previous_status": old_status,
            },
        )
        db.add(audit)
        db.commit()

        logger.info(
            "Job de impressão %s (tenant=%s) reprocessado pelo operador %s",
            job.id,
            tenant_id,
            operator,
        )
        return {
            "success": True,
            "action": action_type,
            "target_id": target_id,
            "message": f"Documento de impressão '{job.document_type}' retornado à fila de impressão.",
        }

    else:
        raise ValueError(f"Tipo de ação desconhecido: '{action_type}'")
