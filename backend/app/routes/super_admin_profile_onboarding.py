from __future__ import annotations

import logging
import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import Field, field_validator
from sqlalchemy.exc import IntegrityError

from ..database import SessionLocal, tenant_session_scope
from ..models import ConfiguracaoRestaurante, Restaurante, SuperAdminAuditLog, Usuario
from ..restaurant_profile_models import RestauranteOperationProfile
from ..security import get_password_hash
from .super_admin import get_current_admin
from .super_admin_onboarding import (
    DEFAULT_TRIAL_DAYS,
    TenantOnboardingRequest,
    _create_default_trial,
    _lock_onboarding_transaction,
    _normalize_payload,
    _reserve_restaurant_id,
    _serialize_conflict,
    _slug_owner_id,
)

logger = logging.getLogger("koma.super_admin.profile_onboarding")
router = APIRouter()

_PROFILE_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


class ProfiledTenantOnboardingRequest(TenantOnboardingRequest):
    """Extensão compatível do onboarding com metadado operacional explícito.

    O perfil nunca cria catálogo, preços, estoque ou modificadores. Ele apenas
    registra a intenção de UX do tenant para etapas assistidas posteriores.
    """

    operation_profile: str | None = Field(default=None, max_length=64)

    @field_validator("operation_profile")
    @classmethod
    def normalize_operation_profile(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().lower()
        if not normalized:
            return None
        if not _PROFILE_RE.fullmatch(normalized):
            raise ValueError(
                "Perfil inválido. Use letras minúsculas, números, hífen ou sublinhado."
            )
        return normalized


@router.post("/restaurantes/provisionar", status_code=status.HTTP_201_CREATED)
def create_profiled_tenant(
    payload: ProfiledTenantOnboardingRequest,
    admin: dict[str, Any] = Depends(get_current_admin),
):
    """Provisiona tenant + perfil na mesma transação tenant-local.

    Este endpoint é a evolução profile-aware do onboarding histórico. A rota
    legada `/restaurantes` permanece compatível durante a migração do frontend.
    Selecionar um perfil não aplica templates nem altera o domínio do cardápio.
    """
    normalized = _normalize_payload(payload)
    operation_profile = payload.operation_profile or "generic"
    db = SessionLocal()
    tenant_id: int | None = None

    try:
        tenant_id = _reserve_restaurant_id(db)

        with tenant_session_scope(db, tenant_id):
            _lock_onboarding_transaction(db)

            if _slug_owner_id(db, normalized["slug"]) is not None:
                raise _serialize_conflict(
                    "O slug/subdomínio informado já está em uso por outro restaurante."
                )

            restaurante = Restaurante(
                id=tenant_id,
                nome=normalized["name"],
                slug=normalized["slug"],
                plano=normalized["plan"],
                saas_status="active",
            )
            db.add(restaurante)
            db.flush()

            db.add(
                RestauranteOperationProfile(
                    restaurante_id=tenant_id,
                    profile_key=operation_profile,
                )
            )

            trial = _create_default_trial(db, tenant_id)

            config = ConfiguracaoRestaurante(
                restaurante_id=tenant_id,
                impressao_nome_restaurante=normalized["name"],
            )
            db.add(config)

            initial_admin = Usuario(
                restaurante_id=tenant_id,
                nome=normalized["admin_name"],
                email=normalized["admin_email"],
                cargo="admin",
                status="ativo",
                senha_hash=get_password_hash(payload.temporary_password),
            )
            db.add(initial_admin)
            db.flush()

            db.add(
                SuperAdminAuditLog(
                    restaurante_id=tenant_id,
                    actor=str(admin.get("user") or "superadmin"),
                    action="SUPERADMIN_TENANT_ONBOARD",
                    reason="Provisionamento inicial de restaurante pelo Super Admin",
                    before_data=None,
                    after_data={
                        "restaurante_id": tenant_id,
                        "nome": normalized["name"],
                        "slug": normalized["slug"],
                        "plano": normalized["plan"],
                        "saas_status": "active",
                        "operation_profile": operation_profile,
                        "trial_status": trial["status"],
                        "trial_started_at": trial["started_at"].isoformat(),
                        "trial_ends_at": trial["ends_at"].isoformat(),
                        "trial_days": trial["days"],
                        "admin_user_id": initial_admin.id,
                        "admin_email": normalized["admin_email"],
                        "mercado_pago": "disconnected",
                    },
                )
            )
            db.commit()

            logger.info(
                "SUPERADMIN TENANT PROFILE ONBOARDED tenant=%s actor=%s plan=%s profile=%s trial_days=%s",
                tenant_id,
                admin.get("user"),
                normalized["plan"],
                operation_profile,
                DEFAULT_TRIAL_DAYS,
            )

            return {
                "id": str(tenant_id),
                "name": normalized["name"],
                "subdomain": normalized["slug"],
                "plan": normalized["plan"],
                "operationProfile": operation_profile,
                "status": "ACTIVE",
                "onlinePaymentStatus": "disconnected",
                "trial": {
                    "status": "active",
                    "startedAt": trial["started_at"].isoformat(),
                    "endsAt": trial["ends_at"].isoformat(),
                    "daysRemaining": DEFAULT_TRIAL_DAYS,
                    "daysGranted": DEFAULT_TRIAL_DAYS,
                },
                "admin": {
                    "id": initial_admin.id,
                    "name": normalized["admin_name"],
                    "email": normalized["admin_email"],
                    "status": "ativo",
                },
                "paths": {
                    "cashier": "/?view=caixa",
                    "publicMenu": f"/c/{normalized['slug']}",
                },
                "message": "Restaurante provisionado com 7 dias grátis.",
            }
    except HTTPException:
        if db.in_transaction():
            db.rollback()
        raise
    except IntegrityError:
        if db.in_transaction():
            db.rollback()
        logger.exception(
            "SUPERADMIN TENANT PROFILE ONBOARD CONFLICT tenant=%s actor=%s",
            tenant_id,
            admin.get("user"),
        )
        raise _serialize_conflict(
            "Não foi possível provisionar: um dos identificadores já está em uso."
        )
    except Exception:
        if db.in_transaction():
            db.rollback()
        logger.exception(
            "SUPERADMIN TENANT PROFILE ONBOARD FAILED tenant=%s actor=%s",
            tenant_id,
            admin.get("user"),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Falha ao provisionar o restaurante. Nenhuma criação parcial foi mantida.",
        )
    finally:
        db.close()
