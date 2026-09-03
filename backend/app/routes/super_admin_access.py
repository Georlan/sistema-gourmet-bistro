import logging
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, model_validator

from ..database import SessionLocal, tenant_session_scope
from ..models import RestaurantPaymentAccount, Restaurante, SuperAdminAuditLog, Usuario
from .super_admin import _discover_restaurant_ids, _payment_status, get_current_admin

logger = logging.getLogger("koma.super_admin.access")
router = APIRouter(prefix="/access", tags=["SuperAdmin"])

ALLOWED_TENANT_ROLES = ("admin", "gerente", "caixa", "garcom", "motoboy")
ADMIN_ROLES = {"admin", "superadmin"}


class UserAccessUpdateRequest(BaseModel):
    status: Literal["ativo", "inativo"] | None = None
    role: Literal["admin", "gerente", "caixa", "garcom", "motoboy"] | None = None
    force: bool = False
    reason: str = Field(min_length=3, max_length=1000)

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def validate_mutation(self):
        if self.status is None and self.role is None:
            raise ValueError("Informe ao menos uma alteração de status ou cargo.")
        return self


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


def _normalize_status(user: Usuario) -> str:
    return str(user.status or "pendente_ativacao").lower().strip()


def _normalize_role(user: Usuario) -> str:
    return str(user.role or user.cargo or "garcom").lower().strip()


def _user_snapshot(user: Usuario) -> dict[str, Any]:
    created_at = getattr(user, "created_at", None)
    return {
        "id": user.id,
        "name": user.nome,
        "email": user.email,
        "phone": user.telefone,
        "role": _normalize_role(user),
        "status": _normalize_status(user),
        "createdAt": created_at.isoformat() if created_at else None,
    }


def _access_state(users: list[Usuario]) -> dict[str, int]:
    active_users = [user for user in users if _normalize_status(user) == "ativo"]
    inactive_users = [user for user in users if _normalize_status(user) == "inativo"]
    pending_users = [
        user for user in users if _normalize_status(user) == "pendente_ativacao"
    ]
    active_admins = [
        user
        for user in active_users
        if _normalize_role(user) in ADMIN_ROLES
    ]
    return {
        "totalUsers": len(users),
        "activeUsers": len(active_users),
        "inactiveUsers": len(inactive_users),
        "pendingUsers": len(pending_users),
        "activeAdmins": len(active_admins),
    }


def _diagnostics(
    *,
    saas_status: str,
    access_state: dict[str, int],
    payment_status: str,
) -> list[dict[str, str]]:
    diagnostics: list[dict[str, str]] = []

    if access_state["activeAdmins"] == 0:
        diagnostics.append(
            {
                "severity": "critical",
                "code": "NO_ACTIVE_ADMIN",
                "message": "Restaurante sem administrador ativo.",
                "action": "Reative um administrador ou force um cargo administrativo.",
            }
        )
    if access_state["activeUsers"] == 0:
        diagnostics.append(
            {
                "severity": "critical",
                "code": "NO_ACTIVE_USERS",
                "message": "Nenhum usuário operacional está ativo.",
                "action": "Revise bloqueios e pendências de acesso.",
            }
        )
    if saas_status == "suspended":
        diagnostics.append(
            {
                "severity": "warning",
                "code": "TENANT_SUSPENDED",
                "message": "Restaurante está suspenso no SaaS.",
                "action": "Revise o motivo da suspensão antes de reativar o tenant.",
            }
        )
    if access_state["pendingUsers"] > 0:
        diagnostics.append(
            {
                "severity": "warning",
                "code": "PENDING_USERS",
                "message": f"{access_state['pendingUsers']} usuário(s) aguardando ativação.",
                "action": "Verifique convites pendentes no fluxo de equipe do restaurante.",
            }
        )
    if access_state["inactiveUsers"] > 0:
        diagnostics.append(
            {
                "severity": "info",
                "code": "INACTIVE_USERS",
                "message": f"{access_state['inactiveUsers']} usuário(s) bloqueado(s).",
                "action": "Reative apenas acessos que ainda sejam necessários.",
            }
        )
    if payment_status == "disconnected":
        diagnostics.append(
            {
                "severity": "info",
                "code": "ONLINE_PAYMENT_DISCONNECTED",
                "message": "Mercado Pago do Cardápio Online está desconectado.",
                "action": "Conecte via OAuth quando o restaurante for operar pagamentos online.",
            }
        )

    return diagnostics


def _tenant_access_payload(db, restaurante: Restaurante, users: list[Usuario]) -> dict[str, Any]:
    state = _access_state(users)
    account = (
        db.query(RestaurantPaymentAccount)
        .filter(
            RestaurantPaymentAccount.restaurante_id == restaurante.id,
            RestaurantPaymentAccount.provider == "mercado_pago",
        )
        .one_or_none()
    )
    online_payment_status = _payment_status(account)
    saas_status = str(restaurante.saas_status or "active").lower().strip()

    return {
        "restaurantId": str(restaurante.id),
        "restaurantName": restaurante.nome,
        "slug": restaurante.slug,
        "plan": restaurante.plano,
        "saasStatus": saas_status.upper(),
        "onlinePaymentStatus": online_payment_status,
        **state,
        "diagnostics": _diagnostics(
            saas_status=saas_status,
            access_state=state,
            payment_status=online_payment_status,
        ),
    }


@router.get("")
def list_access_center(admin: dict[str, Any] = Depends(get_current_admin)):
    """Consolida acessos reais e sinais operacionais por tenant, sem expor credenciais."""
    db = SessionLocal()
    result: list[dict[str, Any]] = []
    try:
        for tenant_id in _discover_restaurant_ids(db):
            with tenant_session_scope(db, tenant_id):
                restaurante = (
                    db.query(Restaurante)
                    .filter(Restaurante.id == tenant_id)
                    .one_or_none()
                )
                if restaurante is None:
                    continue
                users = (
                    db.query(Usuario)
                    .filter(Usuario.restaurante_id == tenant_id)
                    .order_by(Usuario.created_at.asc(), Usuario.nome.asc())
                    .all()
                )
                result.append(_tenant_access_payload(db, restaurante, users))

        logger.info(
            "SUPERADMIN ACCESS LIST actor=%s tenant_count=%s",
            admin.get("user"),
            len(result),
        )
        return result
    except HTTPException:
        raise
    except Exception:
        logger.exception("SUPERADMIN ACCESS LIST FAILED actor=%s", admin.get("user"))
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Falha ao consolidar os acessos dos restaurantes.",
        )
    finally:
        db.close()


@router.get("/restaurantes/{tenant_id}")
def get_tenant_access(
    tenant_id: str,
    admin: dict[str, Any] = Depends(get_current_admin),
):
    tenant_id_int = _parse_tenant_id(tenant_id)
    db = SessionLocal()
    try:
        with tenant_session_scope(db, tenant_id_int):
            restaurante = (
                db.query(Restaurante)
                .filter(Restaurante.id == tenant_id_int)
                .one_or_none()
            )
            if restaurante is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Restaurante não encontrado.",
                )
            users = (
                db.query(Usuario)
                .filter(Usuario.restaurante_id == tenant_id_int)
                .order_by(Usuario.created_at.asc(), Usuario.nome.asc())
                .all()
            )
            payload = _tenant_access_payload(db, restaurante, users)
            payload["users"] = [_user_snapshot(user) for user in users]
            return payload
    except HTTPException:
        raise
    except Exception:
        logger.exception(
            "SUPERADMIN ACCESS DETAIL FAILED tenant=%s actor=%s",
            tenant_id_int,
            admin.get("user"),
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Falha ao carregar os acessos do restaurante.",
        )
    finally:
        db.close()


@router.put("/restaurantes/{tenant_id}/usuarios/{user_id}")
def update_user_access(
    tenant_id: str,
    user_id: str,
    payload: UserAccessUpdateRequest,
    admin: dict[str, Any] = Depends(get_current_admin),
):
    """Altera acesso/cargo e permite override explícito do último admin com auditoria."""
    tenant_id_int = _parse_tenant_id(tenant_id)
    clean_reason = payload.reason.strip()
    if len(clean_reason) < 3:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="O motivo da alteração de acesso é obrigatório.",
        )

    db = SessionLocal()
    try:
        with tenant_session_scope(db, tenant_id_int):
            restaurante = (
                db.query(Restaurante)
                .filter(Restaurante.id == tenant_id_int)
                .one_or_none()
            )
            if restaurante is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Restaurante não encontrado.",
                )

            user = (
                db.query(Usuario)
                .filter(
                    Usuario.id == user_id,
                    Usuario.restaurante_id == tenant_id_int,
                )
                .with_for_update()
                .one_or_none()
            )
            if user is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Usuário não encontrado neste restaurante.",
                )

            before_status = _normalize_status(user)
            before_role = _normalize_role(user)
            next_status = payload.status or before_status
            next_role = payload.role or before_role

            if before_status == "pendente_ativacao" and payload.status == "ativo":
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        "Convite pendente não pode ser ativado administrativamente sem concluir "
                        "o fluxo de credencial do usuário."
                    ),
                )

            if next_status == before_status and next_role == before_role:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Nenhuma alteração efetiva foi informada.",
                )

            active_admin_rows = (
                db.query(Usuario.id, Usuario.status, Usuario.cargo)
                .filter(
                    Usuario.restaurante_id == tenant_id_int,
                    Usuario.cargo.in_(tuple(ADMIN_ROLES)),
                )
                .with_for_update()
                .all()
            )
            active_admin_ids = {
                row.id
                for row in active_admin_rows
                if str(row.status or "").lower().strip() == "ativo"
            }
            removes_last_active_admin = (
                user.id in active_admin_ids
                and len(active_admin_ids) == 1
                and not (next_status == "ativo" and next_role in ADMIN_ROLES)
            )

            if removes_last_active_admin and not payload.force:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        "Esta alteração deixaria o restaurante sem administrador ativo. "
                        "Se essa for uma decisão operacional intencional, repita com force=true e motivo."
                    ),
                )

            before = {
                "user_id": user.id,
                "status": before_status,
                "role": before_role,
            }
            if payload.status is not None:
                user.status = payload.status
            if payload.role is not None:
                user.role = payload.role

            forced = bool(removes_last_active_admin and payload.force)
            after = {
                "user_id": user.id,
                "status": _normalize_status(user),
                "role": _normalize_role(user),
                "forced": forced,
            }
            db.add(
                SuperAdminAuditLog(
                    restaurante_id=tenant_id_int,
                    actor=str(admin.get("user") or "superadmin"),
                    action=(
                        "SUPERADMIN_USER_ACCESS_FORCE_UPDATE"
                        if forced
                        else "SUPERADMIN_USER_ACCESS_UPDATE"
                    ),
                    reason=clean_reason,
                    before_data=before,
                    after_data=after,
                )
            )
            db.commit()
            db.refresh(user)

            users = (
                db.query(Usuario)
                .filter(Usuario.restaurante_id == tenant_id_int)
                .order_by(Usuario.created_at.asc(), Usuario.nome.asc())
                .all()
            )
            tenant_payload = _tenant_access_payload(db, restaurante, users)

            logger.warning(
                "SUPERADMIN USER ACCESS UPDATED tenant=%s user=%s actor=%s forced=%s",
                tenant_id_int,
                user.id,
                admin.get("user"),
                forced,
            )
            return {
                "message": "Acesso do usuário atualizado com sucesso.",
                "forced": forced,
                "user": _user_snapshot(user),
                "tenant": tenant_payload,
            }
    except HTTPException:
        if db.in_transaction():
            db.rollback()
        raise
    except Exception:
        if db.in_transaction():
            db.rollback()
        logger.exception(
            "SUPERADMIN USER ACCESS UPDATE FAILED tenant=%s user=%s actor=%s",
            tenant_id_int,
            user_id,
            admin.get("user"),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Falha ao atualizar o acesso do usuário.",
        )
    finally:
        db.close()
