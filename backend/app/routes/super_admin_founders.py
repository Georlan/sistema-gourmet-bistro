"""Administração auditável do programa KÔMA Founders (limite de 5 beneficiários)."""
from __future__ import annotations

import datetime
import threading
from decimal import Decimal
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from ..database import SessionLocal, tenant_session_scope
from ..models import Restaurante, SuperAdminAuditLog
from ..saas_billing_models import SaaSCommercialGrant
from ..subscription import (
    FOUNDERS_COHORT_CODE,
    FOUNDERS_MAX_BENEFICIARIES,
    FOUNDERS_MONTHLY_PRICE,
)
from .super_admin import _discover_restaurant_ids, get_current_admin
from .super_admin_profile_onboarding import _parse_tenant_id

router = APIRouter()
_FOUNDERS_LOCK = threading.Lock()


class FoundersGrantRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(min_length=3, max_length=1000)

    @field_validator("reason")
    @classmethod
    def clean_reason(cls, value: str) -> str:
        cleaned = value.strip()
        if len(cleaned) < 3:
            raise ValueError("Informe um motivo com pelo menos 3 caracteres.")
        return cleaned


class FoundersRevokeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(min_length=10, max_length=1000)
    confirm_exceptional_revocation: Literal[True]

    @field_validator("reason")
    @classmethod
    def clean_reason(cls, value: str) -> str:
        cleaned = value.strip()
        if len(cleaned) < 10:
            raise ValueError("Informe uma justificativa formal com pelo menos 10 caracteres.")
        return cleaned


def _serialize_grant(grant: SaaSCommercialGrant, restaurant_name: str | None = None) -> dict[str, Any]:
    return {
        "id": grant.id,
        "restaurantId": str(grant.restaurante_id),
        "restaurantName": restaurant_name,
        "cohortCode": grant.cohort_code,
        "fixedMonthlyPrice": str(Decimal(str(grant.fixed_monthly_price)).quantize(Decimal("0.01"))),
        "freeAddonLicenses": bool(grant.free_addon_licenses),
        "active": bool(grant.active),
        "grantedBy": grant.granted_by,
        "reason": grant.reason,
        "grantedAt": grant.granted_at.isoformat() if grant.granted_at else None,
        "revokedBy": grant.revoked_by,
        "revokeReason": grant.revoke_reason,
        "revokedAt": grant.revoked_at.isoformat() if grant.revoked_at else None,
    }


def _collect_founders_grants(db) -> list[dict[str, Any]]:
    grants: list[dict[str, Any]] = []
    for tenant_id in _discover_restaurant_ids(db):
        with tenant_session_scope(db, tenant_id):
            rows = (
                db.query(SaaSCommercialGrant, Restaurante.nome)
                .join(Restaurante, Restaurante.id == SaaSCommercialGrant.restaurante_id)
                .filter(
                    SaaSCommercialGrant.restaurante_id == tenant_id,
                    SaaSCommercialGrant.cohort_code == FOUNDERS_COHORT_CODE,
                )
                .order_by(SaaSCommercialGrant.granted_at.asc())
                .all()
            )
            for grant, name in rows:
                grants.append(_serialize_grant(grant, name))
    return grants


@router.get("/founders")
def list_founders_grants(admin: dict = Depends(get_current_admin)):
    db = SessionLocal()
    try:
        grants = _collect_founders_grants(db)
        active_count = sum(1 for item in grants if item["active"])
        distinct_beneficiaries = len({item["restaurantId"] for item in grants})
        return {
            "cohortCode": FOUNDERS_COHORT_CODE,
            "maxBeneficiaries": FOUNDERS_MAX_BENEFICIARIES,
            "activeCount": active_count,
            "totalHistoricalBeneficiaries": distinct_beneficiaries,
            "remainingSlots": max(0, FOUNDERS_MAX_BENEFICIARIES - distinct_beneficiaries),
            "monthlyPrice": str(FOUNDERS_MONTHLY_PRICE),
            "grants": grants,
        }
    finally:
        db.close()


@router.post("/founders/{tenant_id}", status_code=201)
def grant_founders_benefit(
    tenant_id: str,
    payload: FoundersGrantRequest,
    admin: dict = Depends(get_current_admin),
):
    parsed_id = _parse_tenant_id(tenant_id)
    with _FOUNDERS_LOCK:
        db = SessionLocal()
        try:
            if db.get_bind().dialect.name == "postgresql":
                db.execute(text("SELECT pg_advisory_xact_lock(hashtext('koma_founders_5'))"))

            all_grants = _collect_founders_grants(db)
            active_grants = [item for item in all_grants if item["active"]]
            distinct_beneficiaries = {item["restaurantId"] for item in all_grants}
            if any(item["restaurantId"] == str(parsed_id) for item in active_grants):
                raise HTTPException(409, "Este restaurante já possui benefício KÔMA Founders ativo.")
            if (
                str(parsed_id) not in distinct_beneficiaries
                and len(distinct_beneficiaries) >= FOUNDERS_MAX_BENEFICIARIES
            ):
                raise HTTPException(
                    409,
                    f"Limite máximo de {FOUNDERS_MAX_BENEFICIARIES} beneficiários KÔMA Founders atingido; vagas não são reutilizáveis.",
                )

            with tenant_session_scope(db, parsed_id):
                restaurant = (
                    db.query(Restaurante)
                    .filter(Restaurante.id == parsed_id)
                    .with_for_update()
                    .one_or_none()
                )
                if restaurant is None:
                    raise HTTPException(404, "Restaurante não encontrado.")

                grant = SaaSCommercialGrant(
                    restaurante_id=parsed_id,
                    cohort_code=FOUNDERS_COHORT_CODE,
                    fixed_monthly_price=FOUNDERS_MONTHLY_PRICE,
                    free_addon_licenses=True,
                    active=True,
                    granted_by=str(admin["user"]),
                    reason=payload.reason,
                )
                db.add(grant)
                db.flush()
                serialized = _serialize_grant(grant, restaurant.nome)
                db.add(
                    SuperAdminAuditLog(
                        restaurante_id=parsed_id,
                        actor=str(admin["user"]),
                        action="SUPERADMIN_FOUNDERS_GRANT",
                        reason=payload.reason,
                        before_data=None,
                        after_data=serialized,
                    )
                )
                db.commit()
                return serialized
        except IntegrityError:
            db.rollback()
            raise HTTPException(409, "Este restaurante já possui benefício KÔMA Founders ativo.")
        except HTTPException:
            db.rollback()
            raise
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()


@router.post("/founders/{tenant_id}/revoke")
def revoke_founders_benefit(
    tenant_id: str,
    payload: FoundersRevokeRequest,
    admin: dict = Depends(get_current_admin),
):
    parsed_id = _parse_tenant_id(tenant_id)
    with _FOUNDERS_LOCK:
        db = SessionLocal()
        try:
            with tenant_session_scope(db, parsed_id):
                grant = (
                    db.query(SaaSCommercialGrant)
                    .filter(
                        SaaSCommercialGrant.restaurante_id == parsed_id,
                        SaaSCommercialGrant.cohort_code == FOUNDERS_COHORT_CODE,
                        SaaSCommercialGrant.active.is_(True),
                    )
                    .with_for_update()
                    .one_or_none()
                )
                if grant is None:
                    raise HTTPException(404, "Benefício KÔMA Founders ativo não encontrado para este restaurante.")

                before = _serialize_grant(grant)
                grant.active = False
                grant.revoked_by = str(admin["user"])
                grant.revoke_reason = payload.reason
                grant.revoked_at = datetime.datetime.now(datetime.timezone.utc)
                db.flush()
                after = _serialize_grant(grant)
                db.add(
                    SuperAdminAuditLog(
                        restaurante_id=parsed_id,
                        actor=str(admin["user"]),
                        action="SUPERADMIN_FOUNDERS_REVOKE",
                        reason=payload.reason,
                        before_data=before,
                        after_data=after,
                    )
                )
                db.commit()
                return after
        except HTTPException:
            db.rollback()
            raise
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()
