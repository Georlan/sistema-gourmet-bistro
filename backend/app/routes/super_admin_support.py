import datetime
import logging
import uuid

from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from ..database import SessionLocal, get_db, tenant_session_scope
from ..models import Restaurante, SuperAdminAuditLog
from ..security import create_access_token, get_current_user_for_support_action
from ..services.support_investigation_service import (
    build_investigation_triage_bundle,
    record_investigation_agent_result,
)
from ..support_models import CustomerSupportFeedback, SupportInvestigation, SupportSession
from .super_admin import get_current_admin

logger = logging.getLogger("koma.super_admin.support")
router = APIRouter(prefix="/support", tags=["SuperAdminSupport"])


class SupportSessionStartRequest(BaseModel):
    reason: str = Field(min_length=5, max_length=1000)
    duration_minutes: int = Field(default=30, ge=5, le=120)

    model_config = ConfigDict(extra="forbid")

    @field_validator("reason")
    @classmethod
    def normalize_reason(cls, value: str) -> str:
        normalized = value.strip()
        if len(normalized) < 5:
            raise ValueError("O motivo precisa ter pelo menos 5 caracteres úteis.")
        return normalized


class SupportSessionEndRequest(BaseModel):
    reason: str = Field(
        default="Encerramento manual da sessão pelo operador.",
        min_length=3,
        max_length=1000,
    )

    model_config = ConfigDict(extra="forbid")

    @field_validator("reason")
    @classmethod
    def normalize_reason(cls, value: str) -> str:
        normalized = value.strip()
        if len(normalized) < 3:
            raise ValueError("O motivo precisa ter pelo menos 3 caracteres úteis.")
        return normalized


def _parse_tenant_id(tenant_id: str) -> int:
    try:
        parsed = int(tenant_id)
        if parsed <= 0:
            raise ValueError()
        return parsed
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="ID do restaurante inválido.",
        )


@router.post("/{tenant_id}/start")
def start_support_session(
    tenant_id: str,
    payload: SupportSessionStartRequest,
    admin: dict = Depends(get_current_admin),
):
    """Inicia uma sessão de suporte administrativo temporária e auditada no tenant.

    O Super Admin autentica com restaurante_id=0, portanto toda leitura/escrita
    tenant-owned deste fluxo precisa entrar explicitamente no escopo do tenant alvo
    antes de tocar tabelas protegidas por RLS.
    """
    target_tenant_id = _parse_tenant_id(tenant_id)
    operator = str(admin.get("user") or "superadmin")
    clean_reason = payload.reason

    with SessionLocal() as db:
        with tenant_session_scope(db, target_tenant_id):
            # O lock do restaurante serializa inícios concorrentes mesmo quando ainda
            # não existe uma support_session ativa para bloquear.
            restaurante = (
                db.query(Restaurante)
                .filter(Restaurante.id == target_tenant_id)
                .with_for_update()
                .one_or_none()
            )
            if restaurante is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Estabelecimento não localizado.",
                )

            tenant_name = str(restaurante.nome or f"Restaurante {target_tenant_id}")
            now_utc = datetime.datetime.now(datetime.timezone.utc)
            expires_at = now_utc + datetime.timedelta(minutes=payload.duration_minutes)
            session_id = uuid.uuid4().hex
            token_jti = uuid.uuid4().hex

            active_sessions = (
                db.query(SupportSession)
                .filter(
                    SupportSession.restaurante_id == target_tenant_id,
                    SupportSession.status == "active",
                )
                .with_for_update()
                .all()
            )
            superseded_sessions: list[str] = []
            for session_rec in active_sessions:
                session_rec.status = "ended"
                session_rec.ended_at = now_utc
                superseded_sessions.append(str(session_rec.id))

            support_record = SupportSession(
                id=session_id,
                restaurante_id=target_tenant_id,
                operator=operator,
                reason=clean_reason,
                duration_minutes=payload.duration_minutes,
                token_jti=token_jti,
                status="active",
                started_at=now_utc,
                expires_at=expires_at,
            )
            db.add(support_record)
            db.add(
                SuperAdminAuditLog(
                    restaurante_id=target_tenant_id,
                    actor=operator,
                    action="SUPERADMIN_SUPPORT_SESSION_START",
                    reason=clean_reason,
                    after_data={
                        "session_id": session_id,
                        "duration_minutes": payload.duration_minutes,
                        "expires_at": expires_at.isoformat(),
                        "tenant_name": tenant_name,
                        "superseded_sessions": superseded_sessions,
                    },
                )
            )
            db.commit()

        access_token = create_access_token(
            subject=f"support:{operator}",
            restaurante_id=target_tenant_id,
            role="admin",
            expires_delta=datetime.timedelta(minutes=payload.duration_minutes),
            extra_claims={
                "support_mode": True,
                "support_session_id": session_id,
                "jti": token_jti,
            },
        )

        logger.info(
            "Sessão de suporte iniciada para restaurante %s pelo operador %s "
            "(sessão=%s, duração=%s min)",
            target_tenant_id,
            operator,
            session_id,
            payload.duration_minutes,
        )

        return {
            "session_id": session_id,
            "access_token": access_token,
            "token_type": "bearer",
            "restaurant_id": target_tenant_id,
            "restaurant_name": tenant_name,
            "operator": operator,
            "reason": clean_reason,
            "duration_minutes": payload.duration_minutes,
            "expires_at": expires_at.isoformat(),
            "support_url": "/?view=caixa&support=1",
        }


@router.post("/{tenant_id}/end")
def end_support_session(
    tenant_id: str,
    payload: SupportSessionEndRequest = SupportSessionEndRequest(),
    admin: dict = Depends(get_current_admin),
):
    """Encerra as sessões de suporte ativas de um restaurante pelo Super Admin."""
    target_tenant_id = _parse_tenant_id(tenant_id)
    operator = str(admin.get("user") or "superadmin")
    clean_reason = payload.reason
    now_utc = datetime.datetime.now(datetime.timezone.utc)

    with SessionLocal() as db:
        with tenant_session_scope(db, target_tenant_id):
            active_sessions = (
                db.query(SupportSession)
                .filter(
                    SupportSession.restaurante_id == target_tenant_id,
                    SupportSession.status == "active",
                )
                .with_for_update()
                .all()
            )

            if not active_sessions:
                return {
                    "message": "Nenhuma sessão de suporte ativa para este restaurante.",
                    "closed_count": 0,
                }

            closed_ids: list[str] = []
            for session_rec in active_sessions:
                session_rec.status = "ended"
                session_rec.ended_at = now_utc
                closed_ids.append(str(session_rec.id))

            db.add(
                SuperAdminAuditLog(
                    restaurante_id=target_tenant_id,
                    actor=operator,
                    action="SUPERADMIN_SUPPORT_SESSION_END",
                    reason=clean_reason,
                    after_data={
                        "closed_sessions": closed_ids,
                        "ended_at": now_utc.isoformat(),
                    },
                )
            )
            db.commit()

        logger.info(
            "Sessões de suporte encerradas para restaurante %s pelo operador %s: %s",
            target_tenant_id,
            operator,
            closed_ids,
        )

        return {
            "message": "Sessão de suporte encerrada com sucesso.",
            "closed_count": len(closed_ids),
            "closed_sessions": closed_ids,
        }


@router.get("/{tenant_id}/active")
def get_active_support_session(
    tenant_id: str,
    admin: dict = Depends(get_current_admin),
):
    """Consulta se há sessão de suporte ativa para o restaurante."""
    target_tenant_id = _parse_tenant_id(tenant_id)
    now_utc = datetime.datetime.now(datetime.timezone.utc)

    with SessionLocal() as db:
        with tenant_session_scope(db, target_tenant_id):
            session_rec = (
                db.query(SupportSession)
                .filter(
                    SupportSession.restaurante_id == target_tenant_id,
                    SupportSession.status == "active",
                )
                .order_by(SupportSession.started_at.desc())
                .first()
            )

            if session_rec is None:
                return {"active": False, "session": None}

            expires_at = session_rec.expires_at
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=datetime.timezone.utc)

            if now_utc > expires_at:
                session_rec.status = "expired"
                db.commit()
                return {"active": False, "session": None}

            remaining_seconds = max(0, int((expires_at - now_utc).total_seconds()))
            payload = {
                "active": True,
                "session": {
                    "id": session_rec.id,
                    "operator": session_rec.operator,
                    "reason": session_rec.reason,
                    "started_at": session_rec.started_at.isoformat(),
                    "expires_at": expires_at.isoformat(),
                    "remaining_seconds": remaining_seconds,
                },
            }

        return payload


@router.post("/end-current")
def end_current_support_session(
    payload: SupportSessionEndRequest = SupportSessionEndRequest(),
    current_user=Depends(get_current_user_for_support_action),
    db: Session = Depends(get_db),
):
    """Permite ao operador encerrar sua própria sessão pelo banner operacional."""
    if not getattr(current_user, "is_support_mode", False):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A sessão atual não é uma sessão de suporte administrativo.",
        )

    session_id = str(getattr(current_user, "support_session_id", ""))
    target_tenant_id = int(current_user.restaurante_id)
    operator = str(getattr(current_user, "support_operator", current_user.id))
    clean_reason = payload.reason
    now_utc = datetime.datetime.now(datetime.timezone.utc)

    session_rec = (
        db.query(SupportSession)
        .filter(
            SupportSession.id == session_id,
            SupportSession.restaurante_id == target_tenant_id,
        )
        .first()
    )

    if session_rec:
        session_rec.status = "ended"
        session_rec.ended_at = now_utc

    db.add(
        SuperAdminAuditLog(
            restaurante_id=target_tenant_id,
            actor=operator,
            action="SUPERADMIN_SUPPORT_SESSION_END",
            reason=clean_reason,
            after_data={
                "session_id": session_id,
                "ended_by": "operator_banner",
                "ended_at": now_utc.isoformat(),
            },
        )
    )
    db.commit()

    logger.info(
        "Sessão de suporte %s encerrada pelo próprio operador %s no restaurante %s",
        session_id,
        operator,
        target_tenant_id,
    )

    return {"message": "Sessão de suporte encerrada com sucesso.", "session_id": session_id}


@router.get("/{tenant_id}/feedbacks")
def list_tenant_support_feedbacks(
    tenant_id: str,
    limit: int = Query(default=20, ge=1, le=50),
    admin: dict = Depends(get_current_admin),
):
    """Lista chamados recentes de Ajuda e feedback de um restaurante (somente leitura)."""
    _ = admin
    target_tenant_id = _parse_tenant_id(tenant_id)
    with SessionLocal() as db:
        with tenant_session_scope(db, target_tenant_id):
            rows = (
                db.query(CustomerSupportFeedback)
                .filter(CustomerSupportFeedback.restaurante_id == target_tenant_id)
                .order_by(CustomerSupportFeedback.created_at.desc())
                .limit(limit)
                .all()
            )
            items = [
                {
                    "id": str(row.id),
                    "kind": str(row.kind),
                    "message": str(row.message),
                    "pagePath": row.page_path,
                    "reporterName": row.reporter_name,
                    "reporterRole": row.reporter_role,
                    "status": str(row.status),
                    "context": dict(row.context_metadata) if isinstance(row.context_metadata, dict) else {},
                    "createdAt": row.created_at.isoformat() if row.created_at else None,
                }
                for row in rows
            ]
    return {"tenantId": str(target_tenant_id), "items": items}


class InvestigationAgentResultInput(BaseModel):
    executor_mode: Literal["codex-readonly", "simulated", "dry-run", "manual"]
    simulated: bool = False
    root_cause_hypothesis: str = Field(..., min_length=5, max_length=2000)
    confidence: Literal["high", "medium", "low"]
    affected_components: list[str] = Field(default_factory=list, max_length=15)
    requires_human_approval: bool = True
    recommended_actions: list[str] = Field(default_factory=list, max_length=10)
    safe_customer_guidance_go_id: Optional[str] = Field(None, max_length=64)
    summary: Optional[str] = Field(None, max_length=2000)
    next_status: Literal["completed", "failed"] = "completed"

    model_config = ConfigDict(extra="forbid")


@router.get("/investigations")
def list_support_investigations(
    tenant_id: Optional[str] = Query(default=None),
    status_filter: Optional[str] = Query(default=None, alias="status"),
    severity: Optional[str] = Query(default=None),
    limit: int = Query(default=30, ge=1, le=100),
    admin: dict = Depends(get_current_admin),
):
    """Lista investigações de suporte duráveis para triagem do fundador e agentes."""
    _ = admin
    with SessionLocal() as db:
        if tenant_id is not None:
            target_tid = _parse_tenant_id(tenant_id)
            with tenant_session_scope(db, target_tid):
                q = db.query(SupportInvestigation).filter(
                    SupportInvestigation.restaurante_id == target_tid
                )
                if status_filter:
                    q = q.filter(SupportInvestigation.status == status_filter.strip().lower())
                if severity:
                    q = q.filter(SupportInvestigation.severity == severity.strip().lower())
                rows = q.order_by(SupportInvestigation.last_seen_at.desc()).limit(limit).all()
                return {"items": [build_investigation_triage_bundle(r) for r in rows]}

        q = db.query(SupportInvestigation)
        if status_filter:
            q = q.filter(SupportInvestigation.status == status_filter.strip().lower())
        if severity:
            q = q.filter(SupportInvestigation.severity == severity.strip().lower())
        rows = q.order_by(SupportInvestigation.last_seen_at.desc()).limit(limit).all()
        return {"items": [build_investigation_triage_bundle(r) for r in rows]}


@router.get("/investigations/{investigation_id}")
def get_support_investigation_bundle(
    investigation_id: str,
    admin: dict = Depends(get_current_admin),
):
    """Retorna o pacote estruturado da investigação para ops:triage e agentes."""
    _ = admin
    with SessionLocal() as db:
        inv = db.get(SupportInvestigation, investigation_id.strip())
        if inv is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Investigação não encontrada.",
            )
        return build_investigation_triage_bundle(inv)


@router.post("/investigations/{investigation_id}/result")
def submit_support_investigation_result(
    investigation_id: str,
    payload: InvestigationAgentResultInput,
    admin: dict = Depends(get_current_admin),
):
    """Registra resultado estruturado de um executor de agente com limite de tentativas."""
    _ = admin
    with SessionLocal() as db:
        inv = db.get(SupportInvestigation, investigation_id.strip())
        if inv is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Investigação não encontrada.",
            )
        result_dict: dict[str, Any] = payload.model_dump(exclude={"next_status"})
        updated = record_investigation_agent_result(
            db,
            inv,
            result_payload=result_dict,
            next_status=payload.next_status,
        )
        db.commit()
        return build_investigation_triage_bundle(updated)
