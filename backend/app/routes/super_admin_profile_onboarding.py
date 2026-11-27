from __future__ import annotations

import logging
import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.exc import IntegrityError

from ..database import SessionLocal, tenant_session_scope
from ..models import Restaurante, SuperAdminAuditLog
from ..restaurant_profile_models import RestauranteOperationProfile
from ..services.universal_provisioning import (
    UniversalProvisioningInput,
    provision_restaurant,
)
from .super_admin import get_current_admin
from .super_admin_onboarding import (
    TenantOnboardingRequest,
    _normalize_payload,
    _serialize_conflict,
)

logger = logging.getLogger("koma.super_admin.profile_onboarding")
router = APIRouter()

_PROFILE_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
SUPPORTED_OPERATION_PROFILES = ("generic", "pizzaria", "acai", "churrasco", "marmitaria")


def _normalize_operation_profile(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip().lower()
    if not normalized:
        return None
    if not _PROFILE_RE.fullmatch(normalized):
        raise ValueError(
            "Perfil inválido. Use letras minúsculas, números, hífen ou sublinhado."
        )
    if normalized not in SUPPORTED_OPERATION_PROFILES:
        raise ValueError(
            "Tipo de operação indisponível. Escolha entre: Outro, Pizzaria, Açaí, Churrasco ou Marmitaria."
        )
    return normalized


def _parse_tenant_id(raw: str) -> int:
    try:
        tenant_id = int(raw)
        if tenant_id <= 0:
            raise ValueError()
        return tenant_id
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="ID do restaurante inválido.",
        ) from exc


class ProfiledTenantOnboardingRequest(TenantOnboardingRequest):
    """Extensão compatível do onboarding com metadado operacional explícito.

    O perfil nunca cria catálogo, preços, estoque ou modificadores. Ele apenas
    registra a intenção de UX do tenant para etapas assistidas posteriores.
    """

    operation_profile: str | None = Field(default=None, max_length=64)
    defer_trial: bool = Field(
        default=False,
        description="Se verdadeiro, provisiona o tenant em estado de implantação/preparação sem iniciar os 7 dias grátis",
    )

    @field_validator("operation_profile")
    @classmethod
    def normalize_operation_profile(cls, value: str | None) -> str | None:
        return _normalize_operation_profile(value)


class OperationProfileUpdateRequest(BaseModel):
    operation_profile: str = Field(min_length=1, max_length=64)
    reason: str = Field(min_length=3, max_length=1000)

    model_config = ConfigDict(extra="forbid")

    @field_validator("operation_profile")
    @classmethod
    def validate_operation_profile(cls, value: str) -> str:
        normalized = _normalize_operation_profile(value)
        if normalized is None:
            raise ValueError("Tipo de operação é obrigatório.")
        return normalized


@router.post("/restaurantes/provisionar", status_code=status.HTTP_201_CREATED)
def create_profiled_tenant(
    payload: ProfiledTenantOnboardingRequest,
    admin: dict[str, Any] = Depends(get_current_admin),
):
    """Provisiona tenant administrativo/QA + perfil via motor central."""
    normalized = _normalize_payload(payload)
    operation_profile = payload.operation_profile or "generic"
    db = SessionLocal()
    try:
        result = provision_restaurant(
            db,
            UniversalProvisioningInput(
                name=normalized["name"],
                subdomain=normalized["slug"],
                explicit_subdomain=True,
                plan=normalized["plan"],
                operation_profile=operation_profile,
                admin_name=normalized["admin_name"],
                admin_email=normalized["admin_email"],
                admin_password=payload.temporary_password,
                requested_restaurant_id=payload.restaurant_id,
                defer_trial=bool(payload.defer_trial),
                audit_action="SUPERADMIN_TENANT_ONBOARD",
                audit_reason="Provisionamento inicial de restaurante pelo Super Admin",
                commercial_terms_status="not_contracted",
            ),
            origin="super_admin",
            actor=str(admin.get("user") or "superadmin"),
            allow_id_reuse=True,
            dry_run=False,
        )
        return {
            "id": result["id"],
            "idSelectionMode": result["idSelectionMode"],
            "name": result["name"],
            "subdomain": result["subdomain"],
            "plan": result["plan"],
            "operationProfile": result["operationProfile"],
            "status": result["status"],
            "onlinePaymentStatus": result["onlinePaymentStatus"],
            "commercialTermsStatus": result["commercialTermsStatus"],
            "trial": result["trial"],
            "admin": {
                "id": result["admin"]["id"],
                "name": result["admin"]["name"],
                "email": result["admin"]["email"],
                "status": result["admin"]["status"],
            },
            "paths": result["paths"],
            "message": (
                "Tenant administrativo provisionado sem termos comerciais. "
                "Para cliente comercial, registre o aceite e use a ativação canônica."
            ),
        }
    except HTTPException:
        if db.in_transaction():
            db.rollback()
        raise
    except Exception:
        if db.in_transaction():
            db.rollback()
        logger.exception(
            "SUPERADMIN TENANT PROFILE ONBOARD FAILED actor=%s",
            admin.get("user"),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Falha ao provisionar o restaurante. Nenhuma criação parcial foi mantida.",
        )
    finally:
        db.close()


@router.get("/restaurantes/{tenant_id}/operation-profile")
def get_operation_profile(
    tenant_id: str,
    admin: dict[str, Any] = Depends(get_current_admin),
):
    """Consulta somente o metadado de tipo operacional de um tenant existente."""
    tenant_id_int = _parse_tenant_id(tenant_id)
    db = SessionLocal()
    try:
        with tenant_session_scope(db, tenant_id_int):
            restaurante = db.query(Restaurante).filter(Restaurante.id == tenant_id_int).one_or_none()
            if restaurante is None:
                raise HTTPException(status_code=404, detail="Restaurante não encontrado.")
            profile = (
                db.query(RestauranteOperationProfile)
                .filter(RestauranteOperationProfile.restaurante_id == tenant_id_int)
                .one_or_none()
            )
            return {
                "restaurantId": str(tenant_id_int),
                "operationProfile": str(profile.profile_key) if profile else "generic",
                "behaviorApplied": False,
            }
    finally:
        db.close()


@router.patch("/restaurantes/{tenant_id}/operation-profile")
def update_operation_profile(
    tenant_id: str,
    payload: OperationProfileUpdateRequest,
    admin: dict[str, Any] = Depends(get_current_admin),
):
    """Altera apenas o metadado operacional, sem efeitos automáticos no produto."""
    tenant_id_int = _parse_tenant_id(tenant_id)
    clean_reason = payload.reason.strip()
    db = SessionLocal()
    try:
        with tenant_session_scope(db, tenant_id_int):
            restaurante = (
                db.query(Restaurante)
                .filter(Restaurante.id == tenant_id_int)
                .with_for_update()
                .one_or_none()
            )
            if restaurante is None:
                raise HTTPException(status_code=404, detail="Restaurante não encontrado.")

            profile = (
                db.query(RestauranteOperationProfile)
                .filter(RestauranteOperationProfile.restaurante_id == tenant_id_int)
                .with_for_update()
                .one_or_none()
            )
            previous = str(profile.profile_key) if profile else "generic"
            next_profile = payload.operation_profile

            if previous == next_profile:
                return {
                    "restaurantId": str(tenant_id_int),
                    "operationProfile": next_profile,
                    "behaviorApplied": False,
                    "message": "Tipo de operação já estava configurado com este valor.",
                }

            if profile is None:
                profile = RestauranteOperationProfile(
                    restaurante_id=tenant_id_int,
                    profile_key=next_profile,
                )
                db.add(profile)
            else:
                profile.profile_key = next_profile

            db.add(
                SuperAdminAuditLog(
                    restaurante_id=tenant_id_int,
                    actor=str(admin.get("user") or "superadmin"),
                    action="SUPERADMIN_OPERATION_PROFILE_UPDATE",
                    reason=clean_reason,
                    before_data={"operation_profile": previous},
                    after_data={
                        "operation_profile": next_profile,
                        "behavior_applied": False,
                    },
                )
            )
            db.commit()

            logger.info(
                "SUPERADMIN OPERATION PROFILE UPDATED tenant=%s actor=%s from=%s to=%s",
                tenant_id_int,
                admin.get("user"),
                previous,
                next_profile,
            )
            return {
                "restaurantId": str(tenant_id_int),
                "operationProfile": next_profile,
                "behaviorApplied": False,
                "message": "Tipo de operação salvo como configuração, sem alterar o funcionamento do restaurante.",
            }
    except HTTPException:
        if db.in_transaction():
            db.rollback()
        raise
    except Exception:
        if db.in_transaction():
            db.rollback()
        logger.exception("SUPERADMIN OPERATION PROFILE UPDATE FAILED tenant=%s", tenant_id_int)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Falha ao atualizar o tipo de operação do restaurante.",
        )
    finally:
        db.close()
