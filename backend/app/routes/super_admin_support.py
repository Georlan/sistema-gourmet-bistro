import datetime
import logging
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from ..database import SessionLocal, get_db, tenant_session_scope
from ..models import Restaurante, SuperAdminAuditLog
from ..security import create_access_token, get_current_user
from ..support_models import SupportOperatorUser, SupportSession
from .super_admin import get_current_admin

logger = logging.getLogger("koma.super_admin.support")
router = APIRouter(prefix="/support", tags=["SuperAdminSupport"])


class SupportSessionStartRequest(BaseModel):
    reason: str = Field(min_length=5, max_length=1000)
    duration_minutes: int = Field(default=30, ge=5, le=120)

    model_config = ConfigDict(extra="forbid")


class SupportSessionEndRequest(BaseModel):
    reason: str = Field(default="Encerramento manual da sessão pelo operador.", min_length=3, max_length=1000)

    model_config = ConfigDict(extra="forbid")


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

    Não usa credenciais do cliente nem expõe senhas ou tokens existentes.
    Cria uma identidade administrativa própria com vigência delimitada,
    registrada em trilha de auditoria append-only.
    """
    target_tenant_id = _parse_tenant_id(tenant_id)
    operator = str(admin.get("user") or "superadmin")
    clean_reason = payload.reason.strip()

    with SessionLocal() as db:
        restaurante = (
            db.query(Restaurante)
            .filter(Restaurante.id == target_tenant_id)
            .first()
        )
        if not restaurante:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Estabelecimento não localizado.",
            )

        now_utc = datetime.datetime.now(datetime.timezone.utc)
        expires_at = now_utc + datetime.timedelta(minutes=payload.duration_minutes)
        session_id = uuid.uuid4().hex
        token_jti = uuid.uuid4().hex

        # Encerra com lock qualquer sessão de suporte anterior que ainda esteja ativa no tenant
        active_sessions = (
            db.query(SupportSession)
            .filter(
                SupportSession.restaurante_id == target_tenant_id,
                SupportSession.status == "active",
            )
            .all()
        )
        for s in active_sessions:
            s.status = "ended"
            s.ended_at = now_utc

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

        # Trilha de auditoria append-only
        audit_log = SuperAdminAuditLog(
            restaurante_id=target_tenant_id,
            actor=operator,
            action="SUPERADMIN_SUPPORT_SESSION_START",
            reason=clean_reason,
            after_data={
                "session_id": session_id,
                "duration_minutes": payload.duration_minutes,
                "expires_at": expires_at.isoformat(),
                "tenant_name": restaurante.nome,
            },
        )
        db.add(audit_log)
        db.commit()

        # Gera o token de acesso operacional em Support Mode
        access_token = create_access_token(
            subject=f"support:{operator}",
            restaurante_id=target_tenant_id,
            role="admin",
            expires_delta=datetime.timedelta(minutes=payload.duration_minutes),
            extra_claims={
                "support_mode": True,
                "support_session_id": session_id,
                "operator": operator,
                "reason": clean_reason,
                "jti": token_jti,
            },
        )

        logger.info(
            "Sessão de suporte iniciada para restaurante %s pelo operador %s (sessão=%s, duração=%s min)",
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
            "restaurant_name": restaurante.nome,
            "operator": operator,
            "reason": clean_reason,
            "duration_minutes": payload.duration_minutes,
            "expires_at": expires_at.isoformat(),
            "support_url": f"/?view=caixa&support=1",
        }


@router.post("/{tenant_id}/end")
def end_support_session(
    tenant_id: str,
    payload: SupportSessionEndRequest = SupportSessionEndRequest(),
    admin: dict = Depends(get_current_admin),
):
    """Encerra a sessão de suporte ativa de um restaurante a partir do painel Super Admin."""
    target_tenant_id = _parse_tenant_id(tenant_id)
    operator = str(admin.get("user") or "superadmin")
    clean_reason = payload.reason.strip()
    now_utc = datetime.datetime.now(datetime.timezone.utc)

    with SessionLocal() as db:
        active_sessions = (
            db.query(SupportSession)
            .filter(
                SupportSession.restaurante_id == target_tenant_id,
                SupportSession.status == "active",
            )
            .all()
        )

        if not active_sessions:
            return {
                "message": "Nenhuma sessão de suporte ativa para este restaurante.",
                "closed_count": 0,
            }

        closed_ids = []
        for s in active_sessions:
            s.status = "ended"
            s.ended_at = now_utc
            closed_ids.append(s.id)

        audit_log = SuperAdminAuditLog(
            restaurante_id=target_tenant_id,
            actor=operator,
            action="SUPERADMIN_SUPPORT_SESSION_END",
            reason=clean_reason,
            after_data={
                "closed_sessions": closed_ids,
                "ended_at": now_utc.isoformat(),
            },
        )
        db.add(audit_log)
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
        session_rec = (
            db.query(SupportSession)
            .filter(
                SupportSession.restaurante_id == target_tenant_id,
                SupportSession.status == "active",
            )
            .order_by(SupportSession.started_at.desc())
            .first()
        )

        if not session_rec:
            return {"active": False, "session": None}

        exp = session_rec.expires_at
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=datetime.timezone.utc)

        if now_utc > exp:
            session_rec.status = "expired"
            db.commit()
            return {"active": False, "session": None}

        remaining_seconds = max(0, int((exp - now_utc).total_seconds()))

        return {
            "active": True,
            "session": {
                "id": session_rec.id,
                "operator": session_rec.operator,
                "reason": session_rec.reason,
                "started_at": session_rec.started_at.isoformat(),
                "expires_at": exp.isoformat(),
                "remaining_seconds": remaining_seconds,
            },
        }


@router.post("/end-current")
def end_current_support_session(
    payload: SupportSessionEndRequest = SupportSessionEndRequest(),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Permite que o operador em Modo Suporte encerre sua sessão diretamente da barra de navegação."""
    if not getattr(current_user, "is_support_mode", False):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A sessão atual não é uma sessão de suporte administrativo.",
        )

    session_id = str(getattr(current_user, "support_session_id", ""))
    target_tenant_id = int(current_user.restaurante_id)
    operator = str(getattr(current_user, "support_operator", current_user.id))
    clean_reason = payload.reason.strip()
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

    audit_log = SuperAdminAuditLog(
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
    db.add(audit_log)
    db.commit()

    logger.info(
        "Sessão de suporte %s encerrada pelo próprio operador %s no restaurante %s",
        session_id,
        operator,
        target_tenant_id,
    )

    return {"message": "Sessão de suporte encerrada com sucesso.", "session_id": session_id}
