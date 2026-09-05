from __future__ import annotations

import datetime
import re
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from ..contract_models import ContractAcceptance, RestaurantContractAcceptance
from ..database import SessionLocal, tenant_session_scope
from ..models import Restaurante, SuperAdminAuditLog
from .super_admin import get_current_admin


router = APIRouter(prefix="/contracts", tags=["SuperAdmin Contracts"])
_PROTOCOL_RE = re.compile(r"^KOMA-CTR-\d{8}-[A-F0-9]{12}$")


class ContractLinkRequest(BaseModel):
    restaurant_id: int = Field(gt=0)
    protocol: str = Field(min_length=20, max_length=64)
    reason: str = Field(min_length=3, max_length=1000)

    model_config = ConfigDict(extra="forbid")

    @field_validator("protocol")
    @classmethod
    def normalize_protocol(cls, value: str) -> str:
        normalized = value.strip().upper()
        if not _PROTOCOL_RE.fullmatch(normalized):
            raise ValueError("Protocolo contratual inválido")
        return normalized


def _resolve_acceptance(db, protocol: str) -> dict[str, Any] | None:
    if db.get_bind().dialect.name == "postgresql":
        row = db.execute(
            text(
                "SELECT * FROM koma_internal.resolve_contract_acceptance_for_link(:protocol)"
            ),
            {"protocol": protocol},
        ).mappings().one_or_none()
        return dict(row) if row else None

    acceptance = (
        db.query(ContractAcceptance)
        .filter(ContractAcceptance.protocol == protocol)
        .one_or_none()
    )
    if acceptance is None:
        return None
    return {
        "acceptance_id": acceptance.id,
        "protocol": acceptance.protocol,
        "plan": acceptance.plan,
        "billing_cycle": acceptance.billing_cycle,
        "restaurant_name": acceptance.restaurant_name,
        "contracting_party_name": acceptance.contracting_party_name,
        "email": acceptance.email,
    }


@router.get("/preview/{protocol}")
def preview_contract(
    protocol: str,
    admin: dict[str, Any] = Depends(get_current_admin),
):
    normalized = protocol.strip().upper()
    if not _PROTOCOL_RE.fullmatch(normalized):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Protocolo contratual inválido.",
        )

    db = SessionLocal()
    try:
        acceptance = _resolve_acceptance(db, normalized)
        if acceptance is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Aceite contratual não encontrado.",
            )
        return {
            "protocol": acceptance["protocol"],
            "plan": acceptance["plan"],
            "billingCycle": acceptance["billing_cycle"],
            "restaurantName": acceptance["restaurant_name"],
            "contractingPartyName": acceptance["contracting_party_name"],
            "email": acceptance["email"],
        }
    finally:
        db.close()


@router.post("/link")
def link_contract(
    payload: ContractLinkRequest,
    admin: dict[str, Any] = Depends(get_current_admin),
):
    db = SessionLocal()
    try:
        acceptance = _resolve_acceptance(db, payload.protocol)
        if acceptance is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Aceite contratual não encontrado.",
            )

        tenant_id = int(payload.restaurant_id)
        with tenant_session_scope(db, tenant_id):
            restaurant = (
                db.query(Restaurante)
                .filter(Restaurante.id == tenant_id)
                .one_or_none()
            )
            if restaurant is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Restaurante não encontrado.",
                )
            if str(restaurant.plano or "").lower() != str(acceptance["plan"]).lower():
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        "O plano do tenant não corresponde ao plano congelado no aceite. "
                        "Corrija o plano antes de vincular."
                    ),
                )

            existing = (
                db.query(RestaurantContractAcceptance)
                .filter(
                    RestaurantContractAcceptance.acceptance_id
                    == str(acceptance["acceptance_id"])
                )
                .one_or_none()
            )
            if existing is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Este aceite já está vinculado a um restaurante.",
                )

            link = RestaurantContractAcceptance(
                id=str(uuid.uuid4()),
                restaurante_id=tenant_id,
                acceptance_id=str(acceptance["acceptance_id"]),
                linked_at=datetime.datetime.now(datetime.timezone.utc),
            )
            db.add(link)
            db.add(
                SuperAdminAuditLog(
                    restaurante_id=tenant_id,
                    actor=str(admin.get("user") or "superadmin"),
                    action="SUPERADMIN_CONTRACT_LINK",
                    reason=payload.reason.strip(),
                    before_data=None,
                    after_data={
                        "protocol": payload.protocol,
                        "acceptance_id": str(acceptance["acceptance_id"]),
                        "plan": acceptance["plan"],
                        "billing_cycle": acceptance["billing_cycle"],
                    },
                )
            )
            db.commit()

        return {
            "restaurantId": str(tenant_id),
            "protocol": payload.protocol,
            "plan": acceptance["plan"],
            "billingCycle": acceptance["billing_cycle"],
            "message": "Aceite contratual vinculado ao restaurante com auditoria.",
        }
    except HTTPException:
        if db.in_transaction():
            db.rollback()
        raise
    except IntegrityError as exc:
        if db.in_transaction():
            db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Este aceite já foi vinculado ou o vínculo já existe.",
        ) from exc
    finally:
        db.close()
