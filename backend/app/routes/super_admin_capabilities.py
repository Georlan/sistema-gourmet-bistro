"""Benefícios individuais: control plane auditável, sem alteração de plano."""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator

from ..database import SessionLocal, tenant_session_scope
from ..models import Restaurante, SuperAdminAuditLog
from ..smartpos_models import RestauranteCapability
from ..services.plan_entitlements import (
    KNOWN_ENTITLEMENTS, plan_entitlement_baseline, resolve_plan_entitlements,
)
from .super_admin import get_current_admin
from .super_admin_profile_onboarding import _parse_tenant_id

router = APIRouter()


class CapabilityUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["grant", "revoke", "baseline"]
    reason: str = Field(min_length=3, max_length=1000)

    @field_validator("reason")
    @classmethod
    def clean_reason(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 3:
            raise ValueError("Informe um motivo com pelo menos 3 caracteres.")
        return value


def _snapshot(db, restaurant):
    overrides = db.query(RestauranteCapability).filter(
        RestauranteCapability.restaurante_id == restaurant.id,
        RestauranteCapability.capability.in_(KNOWN_ENTITLEMENTS),
    ).all()
    return {
        "restaurantId": str(restaurant.id),
        "plan": restaurant.plano,
        "baseline": plan_entitlement_baseline(restaurant.id, restaurant.plano),
        "overrides": {row.capability: {"enabled": row.enabled, "source": row.source} for row in overrides},
        "effective": resolve_plan_entitlements(db, restaurant.id, stored_plan=restaurant.plano),
    }


@router.get("/restaurantes/{tenant_id}/capabilities")
def get_capabilities(tenant_id: str, admin: dict = Depends(get_current_admin)):
    tenant_id = _parse_tenant_id(tenant_id)
    db = SessionLocal()
    try:
        with tenant_session_scope(db, tenant_id):
            restaurant = db.query(Restaurante).filter(Restaurante.id == tenant_id).one_or_none()
            if restaurant is None:
                raise HTTPException(404, "Restaurante não encontrado.")
            return _snapshot(db, restaurant)
    finally:
        db.close()


@router.patch("/restaurantes/{tenant_id}/capabilities/{capability}")
def update_capability(
    tenant_id: str, capability: str, payload: CapabilityUpdate,
    admin: dict = Depends(get_current_admin),
):
    tenant_id = _parse_tenant_id(tenant_id)
    if capability not in KNOWN_ENTITLEMENTS:
        raise HTTPException(422, "Recurso desconhecido ou não administrável neste fluxo.")
    db = SessionLocal()
    try:
        with tenant_session_scope(db, tenant_id):
            # Serializa alterações, inclusive a primeira concessão sem linha existente.
            restaurant = db.query(Restaurante).filter(Restaurante.id == tenant_id).with_for_update().one_or_none()
            if restaurant is None:
                raise HTTPException(404, "Restaurante não encontrado.")
            before = _snapshot(db, restaurant)
            row = db.query(RestauranteCapability).filter(
                RestauranteCapability.restaurante_id == tenant_id,
                RestauranteCapability.capability == capability,
            ).one_or_none()
            if payload.mode == "baseline":
                if row is not None:
                    db.delete(row)
            elif row is None:
                db.add(RestauranteCapability(
                    restaurante_id=tenant_id, capability=capability,
                    enabled=payload.mode == "grant", source="manual",
                ))
            else:
                row.enabled = payload.mode == "grant"
                row.source = "manual"
            db.flush()
            after = _snapshot(db, restaurant)
            db.add(SuperAdminAuditLog(
                restaurante_id=tenant_id, actor=str(admin["user"]),
                action="SUPERADMIN_CAPABILITY_UPDATE", reason=payload.reason,
                before_data={"capability": capability, **before},
                after_data={"capability": capability, "mode": payload.mode, **after},
            ))
            db.commit()
            return after
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
