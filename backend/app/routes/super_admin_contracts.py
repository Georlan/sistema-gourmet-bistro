from __future__ import annotations

import datetime
import re
import uuid
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
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


def _decimal_text(value: Any, quantum: str) -> str | None:
    if value is None:
        return None
    return f"{Decimal(str(value)).quantize(Decimal(quantum)):f}"


def _datetime_text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime.datetime):
        return value.isoformat()
    return str(value)


def _admin_inbox_item(row: dict[str, Any]) -> dict[str, Any]:
    linked_restaurante_id = row.get("linked_restaurante_id")
    operational_status = (
        "ACTIVATED" if linked_restaurante_id is not None else "SIGNED_PENDING_ACTIVATION"
    )
    return {
        "acceptanceId": str(row["acceptance_id"]),
        "protocol": str(row["protocol"]),
        "status": operational_status,
        "acceptedAt": _datetime_text(row.get("accepted_at")),
        "restaurantName": str(row.get("restaurant_name") or ""),
        "contractingPartyName": str(row.get("contracting_party_name") or ""),
        "contractingPartyTaxIdLast4": str(
            row.get("contracting_party_tax_id_last4") or ""
        ),
        "representativeName": str(row.get("representative_name") or ""),
        "representativeTaxIdLast4": str(
            row.get("representative_tax_id_last4") or ""
        ),
        "representativeRole": str(row.get("representative_role") or ""),
        "email": str(row.get("email") or ""),
        "phone": str(row.get("phone") or ""),
        "plan": str(row.get("plan") or ""),
        "billingCycle": str(row.get("billing_cycle") or ""),
        "fixedMonthlyPrice": _decimal_text(row.get("fixed_monthly_price"), "0.01"),
        "billingAmount": _decimal_text(row.get("billing_amount"), "0.01"),
        "annualMonthlyEquivalent": _decimal_text(
            row.get("annual_monthly_equivalent"), "0.01"
        ),
        "marketplaceRate": _decimal_text(row.get("marketplace_rate"), "0.000001"),
        "legalVersion": str(row.get("legal_version") or ""),
        "documentHashes": {
            "terms": str(row.get("terms_hash") or ""),
            "commercial": str(row.get("commercial_hash") or ""),
            "dpa": str(row.get("dpa_hash") or ""),
            "privacy": str(row.get("privacy_hash") or ""),
        },
        "linkedRestaurantId": (
            str(linked_restaurante_id) if linked_restaurante_id is not None else None
        ),
        "linkedAt": _datetime_text(row.get("linked_at")),
    }


def _list_acceptances(db, limit: int) -> list[dict[str, Any]]:
    if db.get_bind().dialect.name == "postgresql":
        rows = db.execute(
            text(
                "SELECT * FROM koma_internal.list_contract_acceptances_for_admin(:limit)"
            ),
            {"limit": limit},
        ).mappings().all()
        return [_admin_inbox_item(dict(row)) for row in rows]

    rows = (
        db.query(ContractAcceptance, RestaurantContractAcceptance)
        .outerjoin(
            RestaurantContractAcceptance,
            RestaurantContractAcceptance.acceptance_id == ContractAcceptance.id,
        )
        .order_by(ContractAcceptance.accepted_at.desc())
        .limit(limit)
        .all()
    )
    result: list[dict[str, Any]] = []
    for acceptance, link in rows:
        result.append(
            _admin_inbox_item(
                {
                    "acceptance_id": acceptance.id,
                    "protocol": acceptance.protocol,
                    "accepted_at": acceptance.accepted_at,
                    "restaurant_name": acceptance.restaurant_name,
                    "contracting_party_name": acceptance.contracting_party_name,
                    "contracting_party_tax_id_last4": acceptance.contracting_party_tax_id_last4,
                    "representative_name": acceptance.representative_name,
                    "representative_tax_id_last4": acceptance.representative_tax_id_last4,
                    "representative_role": acceptance.representative_role,
                    "email": acceptance.email,
                    "phone": acceptance.phone,
                    "plan": acceptance.plan,
                    "billing_cycle": acceptance.billing_cycle,
                    "fixed_monthly_price": acceptance.fixed_monthly_price,
                    "billing_amount": acceptance.billing_amount,
                    "annual_monthly_equivalent": acceptance.annual_monthly_equivalent,
                    "marketplace_rate": acceptance.marketplace_rate,
                    "legal_version": acceptance.legal_version,
                    "terms_hash": acceptance.terms_hash,
                    "commercial_hash": acceptance.commercial_hash,
                    "dpa_hash": acceptance.dpa_hash,
                    "privacy_hash": acceptance.privacy_hash,
                    "linked_restaurante_id": link.restaurante_id if link else None,
                    "linked_at": link.linked_at if link else None,
                }
            )
        )
    return result


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


@router.get("")
def list_contracts(
    status_filter: str = Query("all", alias="status"),
    limit: int = Query(100, ge=1, le=200),
    admin: dict[str, Any] = Depends(get_current_admin),
):
    normalized_status = status_filter.strip().lower()
    if normalized_status not in {"all", "pending", "activated"}:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Status inválido. Use all, pending ou activated.",
        )

    db = SessionLocal()
    try:
        items = _list_acceptances(db, limit)
        pending_count = sum(
            item["status"] == "SIGNED_PENDING_ACTIVATION" for item in items
        )
        if normalized_status == "pending":
            filtered = [
                item
                for item in items
                if item["status"] == "SIGNED_PENDING_ACTIVATION"
            ]
        elif normalized_status == "activated":
            filtered = [item for item in items if item["status"] == "ACTIVATED"]
        else:
            filtered = items

        return {
            "items": filtered,
            "pendingCount": pending_count,
            "total": len(items),
            "returned": len(filtered),
        }
    finally:
        db.close()


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
