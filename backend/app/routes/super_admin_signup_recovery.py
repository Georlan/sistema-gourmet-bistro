from __future__ import annotations

import datetime
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from ..database import get_db, tenant_session_scope
from ..models import SuperAdminAuditLog, Usuario
from ..services.restaurant_provisioning import INVITATION_TTL_HOURS, resolve_activation_acceptance
from ..services.signup_notifications import enqueue_activation
from .super_admin import get_current_admin

router = APIRouter(prefix="/signups", tags=["SuperAdmin"])
_PROTOCOL_RE = re.compile(r"^KOMA-CTR-\d{8}-[A-F0-9]{12}$")


class ReissueActivationInviteRequest(BaseModel):
    reason: str = Field(
        default="Reemissão do convite inicial solicitada pelo SuperAdmin",
        min_length=3,
        max_length=255,
    )
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


@router.post("/{protocol}/activation-invite")
def reissue_initial_activation_invite(
    protocol: str,
    payload: ReissueActivationInviteRequest | None = None,
    admin=Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """Gera um novo convite para o primeiro administrador sem recriar tenant/trial."""
    normalized = protocol.strip().upper()
    if not _PROTOCOL_RE.fullmatch(normalized):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Protocolo contratual inválido.",
        )

    acceptance = resolve_activation_acceptance(db, normalized)
    if not acceptance:
        raise HTTPException(status_code=404, detail="Contratação não encontrada.")

    tenant_id = acceptance.get("linked_restaurante_id")
    if not tenant_id:
        raise HTTPException(
            status_code=409,
            detail="A contratação ainda não foi liberada. Libere o restaurante antes de reemitir o convite.",
        )

    expected_email = str(acceptance.get("email") or "").strip().lower()
    expected_name = str(
        acceptance.get("representative_name")
        or acceptance.get("contracting_party_name")
        or "Administrador"
    ).strip()
    restaurant_name = str(acceptance.get("restaurant_name") or "Restaurante").strip()
    phone = str(acceptance.get("phone") or "").strip() or None
    now = datetime.datetime.now(datetime.timezone.utc)
    expires_at = now + datetime.timedelta(hours=INVITATION_TTL_HOURS)
    invitation_token = str(uuid.uuid4())
    delivery_kind = f"activation-reissue-{uuid.uuid4().hex[:12]}"

    with tenant_session_scope(db, int(tenant_id)):
        pending_admin = (
            db.query(Usuario)
            .filter(
                Usuario.restaurante_id == int(tenant_id),
                Usuario.cargo == "admin",
                Usuario.status == "pendente_ativacao",
                Usuario.email == expected_email,
            )
            .with_for_update()
            .first()
        )
        if pending_admin is None:
            active_admin = (
                db.query(Usuario)
                .filter(
                    Usuario.restaurante_id == int(tenant_id),
                    Usuario.cargo == "admin",
                    Usuario.email == expected_email,
                    Usuario.status == "ativo",
                )
                .first()
            )
            if active_admin:
                raise HTTPException(
                    status_code=409,
                    detail="O administrador inicial já ativou a conta; não há convite pendente para reemitir.",
                )
            raise HTTPException(
                status_code=404,
                detail="Administrador inicial pendente não encontrado para esta contratação.",
            )

        pending_admin.token_convite = invitation_token
        pending_admin.token_expira_em = expires_at

        actor_name = getattr(admin, "username", None) or (
            admin.get("user") if isinstance(admin, dict) else "superadmin"
        )
        reason = (
            payload.reason
            if payload and payload.reason
            else "Reemissão do convite inicial solicitada pelo SuperAdmin"
        )
        db.add(
            SuperAdminAuditLog(
                restaurante_id=int(tenant_id),
                actor=f"superadmin:{actor_name}",
                action="SUPERADMIN_SIGNUP_INVITE_REISSUE",
                reason=reason,
                before_data=None,
                after_data={
                    "protocol": normalized,
                    "admin_user_id": pending_admin.id,
                    "admin_status": pending_admin.status,
                    "expires_at": expires_at.isoformat(),
                    "delivery_kind": delivery_kind,
                },
            )
        )
        enqueue_activation(
            db,
            protocol=normalized,
            restaurant_name=restaurant_name,
            representative_name=expected_name,
            email=expected_email,
            phone=phone,
            token=invitation_token,
            kind=delivery_kind,
        )
        db.commit()

    return {
        "success": True,
        "protocol": normalized,
        "restaurant_id": str(tenant_id),
        "expires_at": expires_at.isoformat(),
        "delivery_scheduled": True,
        "message": "Novo convite agendado. O link anterior foi invalidado e não deve mais ser usado.",
    }
