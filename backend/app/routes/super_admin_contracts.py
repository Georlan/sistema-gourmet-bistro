from __future__ import annotations

import datetime
import logging
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
from ..saas_billing_models import SaaSBillingSetup, SaaSPlanChange, SaaSSubscription
from ..services.billing_service import (
    contract_fixed_billing_required,
    get_billing_setup,
    is_billing_enforcement_enabled,
    is_billing_ready,
)
from .super_admin import get_current_admin
from .super_admin_onboarding import DEFAULT_TRIAL_DAYS


logger = logging.getLogger("koma.super_admin.contracts")
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


class ContractActivationRequest(BaseModel):
    reason: str = Field(
        default="Ativação de contratação eletrônica pelo Super Admin",
        min_length=3,
        max_length=1000,
    )

    model_config = ConfigDict(extra="forbid")


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


def _normalize_protocol_path(protocol: str) -> str:
    normalized = protocol.strip().upper()
    if not _PROTOCOL_RE.fullmatch(normalized):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Protocolo contratual inválido.",
        )
    return normalized


def _plan_change_owner(db, acceptance_id: str) -> int | None:
    normalized = str(acceptance_id or "").strip()
    if not normalized:
        return None
    if db.get_bind().dialect.name == "postgresql":
        owner = db.execute(
            text(
                "SELECT koma_internal.plan_change_owner_for_acceptance(:acceptance_id)"
            ),
            {"acceptance_id": normalized},
        ).scalar_one_or_none()
        return int(owner) if owner is not None else None

    SaaSPlanChange.__table__.create(db.get_bind(), checkfirst=True)
    owner_row = (
        db.query(SaaSPlanChange.restaurante_id)
        .filter(SaaSPlanChange.acceptance_id == normalized)
        .one_or_none()
    )
    return int(owner_row[0]) if owner_row is not None else None


def _admin_inbox_item(row: dict[str, Any]) -> dict[str, Any]:
    linked_restaurante_id = row.get("linked_restaurante_id")
    plan_change_restaurante_id = row.get("plan_change_restaurante_id")
    if plan_change_restaurante_id is not None:
        operational_status = (
            "PLAN_CHANGE_APPLIED"
            if linked_restaurante_id is not None
            else "PLAN_CHANGE_PENDING"
        )
    else:
        operational_status = (
            "ACTIVATED"
            if linked_restaurante_id is not None
            else "SIGNED_PENDING_ACTIVATION"
        )
    billing_status = str(row.get("billing_status") or "pending").strip().lower()
    billing_provider = row.get("billing_provider")
    payment_method_type = row.get("payment_method_type")
    billing_amount = row.get("billing_amount")
    fixed_billing_required = True
    if billing_amount is not None:
        try:
            fixed_billing_required = Decimal(str(billing_amount)) > 0
        except Exception:
            fixed_billing_required = True
    effective_billing_status = (
        billing_status if fixed_billing_required else "not_required"
    )
    enforcement_enabled = is_billing_enforcement_enabled()
    is_ready = (billing_status == "ready") or not fixed_billing_required
    activation_eligible = (
        linked_restaurante_id is None
        and plan_change_restaurante_id is None
        and (not enforcement_enabled or is_ready)
    )
    return {
        "acceptanceId": str(row["acceptance_id"]),
        "protocol": str(row["protocol"]),
        "status": operational_status,
        "billingStatus": effective_billing_status,
        "billingProvider": str(billing_provider) if billing_provider else None,
        "paymentMethodType": str(payment_method_type) if payment_method_type else None,
        "billingEnforcementEnabled": enforcement_enabled,
        "activationEligible": activation_eligible,
        "contractPurpose": (
            "plan_change" if plan_change_restaurante_id is not None else "new_subscription"
        ),
        "planChangeRestaurantId": (
            str(plan_change_restaurante_id)
            if plan_change_restaurante_id is not None
            else None
        ),
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


def _ensure_sqlite_billing_tables(db) -> None:
    bind = db.get_bind()
    if bind.dialect.name != "postgresql":
        SaaSBillingSetup.__table__.create(bind, checkfirst=True)
        SaaSSubscription.__table__.create(bind, checkfirst=True)
        SaaSPlanChange.__table__.create(bind, checkfirst=True)


def _list_acceptances(db, limit: int) -> list[dict[str, Any]]:
    if db.get_bind().dialect.name == "postgresql":
        rows = db.execute(
            text(
                "SELECT * FROM koma_internal.list_contract_acceptances_for_admin(:limit)"
            ),
            {"limit": limit},
        ).mappings().all()
        result: list[dict[str, Any]] = []
        for row in rows:
            item = dict(row)
            item["plan_change_restaurante_id"] = _plan_change_owner(
                db,
                str(item.get("acceptance_id") or ""),
            )
            result.append(_admin_inbox_item(item))
        return result

    _ensure_sqlite_billing_tables(db)
    rows = (
        db.query(ContractAcceptance, RestaurantContractAcceptance, SaaSBillingSetup)
        .outerjoin(
            RestaurantContractAcceptance,
            RestaurantContractAcceptance.acceptance_id == ContractAcceptance.id,
        )
        .outerjoin(
            SaaSBillingSetup,
            SaaSBillingSetup.protocol == ContractAcceptance.protocol,
        )
        .order_by(ContractAcceptance.accepted_at.desc())
        .limit(limit)
        .all()
    )
    result: list[dict[str, Any]] = []
    for acceptance, link, billing in rows:
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
                    "billing_status": billing.status if billing else "pending",
                    "billing_provider": billing.provider if billing else None,
                    "payment_method_type": billing.payment_method_type if billing else None,
                    "plan_change_restaurante_id": _plan_change_owner(
                        db,
                        str(acceptance.id),
                    ),
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
        if not row:
            return None
        res = dict(row)
        billing = get_billing_setup(db, protocol)
        if billing:
            res["billing_status"] = billing.status
            res["billing_provider"] = billing.provider
            res["payment_method_type"] = billing.payment_method_type
        else:
            res["billing_status"] = "pending"
            res["billing_provider"] = None
            res["payment_method_type"] = None
        return res

    _ensure_sqlite_billing_tables(db)
    row = (
        db.query(ContractAcceptance, SaaSBillingSetup)
        .outerjoin(
            SaaSBillingSetup,
            SaaSBillingSetup.protocol == ContractAcceptance.protocol,
        )
        .filter(ContractAcceptance.protocol == protocol)
        .one_or_none()
    )
    if row is None:
        return None
    acceptance, billing = row
    return {
        "acceptance_id": acceptance.id,
        "protocol": acceptance.protocol,
        "plan": acceptance.plan,
        "billing_cycle": acceptance.billing_cycle,
        "restaurant_name": acceptance.restaurant_name,
        "contracting_party_name": acceptance.contracting_party_name,
        "email": acceptance.email,
        "billing_status": billing.status if billing else "pending",
        "billing_provider": billing.provider if billing else None,
        "payment_method_type": billing.payment_method_type if billing else None,
    }


def _resolve_activation_acceptance(db, protocol: str) -> dict[str, Any] | None:
    if db.get_bind().dialect.name == "postgresql":
        row = db.execute(
            text(
                "SELECT * FROM koma_internal.resolve_contract_acceptance_for_activation(:protocol)"
            ),
            {"protocol": protocol},
        ).mappings().one_or_none()
        if not row:
            return None
        res = dict(row)
        if "billing_status" not in res or not res["billing_status"]:
            billing = get_billing_setup(db, protocol)
            if billing:
                res["billing_status"] = billing.status
                res["billing_provider"] = billing.provider
                res["payment_method_type"] = billing.payment_method_type
            else:
                res["billing_status"] = "pending"
                res["billing_provider"] = None
                res["payment_method_type"] = None
        return res

    _ensure_sqlite_billing_tables(db)
    row = (
        db.query(ContractAcceptance, RestaurantContractAcceptance, SaaSBillingSetup)
        .outerjoin(
            RestaurantContractAcceptance,
            RestaurantContractAcceptance.acceptance_id == ContractAcceptance.id,
        )
        .outerjoin(
            SaaSBillingSetup,
            SaaSBillingSetup.protocol == ContractAcceptance.protocol,
        )
        .filter(ContractAcceptance.protocol == protocol)
        .one_or_none()
    )
    if row is None:
        return None
    acceptance, link, billing = row
    return {
        "acceptance_id": acceptance.id,
        "protocol": acceptance.protocol,
        "plan": acceptance.plan,
        "billing_cycle": acceptance.billing_cycle,
        "restaurant_name": acceptance.restaurant_name,
        "contracting_party_name": acceptance.contracting_party_name,
        "representative_name": acceptance.representative_name,
        "email": acceptance.email,
        "phone": acceptance.phone,
        "linked_restaurante_id": link.restaurante_id if link else None,
        "linked_at": link.linked_at if link else None,
        "billing_status": billing.status if billing else "pending",
        "billing_provider": billing.provider if billing else None,
        "payment_method_type": billing.payment_method_type if billing else None,
    }


def _activation_response(
    acceptance: dict[str, Any],
    tenant_id: int,
    *,
    slug: str | None = None,
    admin_id: str | None = None,
    trial_ends_at: datetime.datetime | None = None,
    idempotent: bool,
    credential_delivery: str = "pending_notification",
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "restaurantId": str(tenant_id),
        "protocol": str(acceptance["protocol"]),
        "plan": str(acceptance["plan"]),
        "billingCycle": str(acceptance["billing_cycle"]),
        "idempotent": idempotent,
        "credentialDelivery": credential_delivery,
        "message": (
            "Contratação já estava ativada."
            if idempotent
            else "Restaurante provisionado e contrato vinculado com sucesso."
        ),
    }
    if slug is not None:
        payload["subdomain"] = slug
    if admin_id is not None:
        payload["admin"] = {
            "id": admin_id,
            "email": str(acceptance.get("email") or ""),
            "status": "pendente_ativacao",
        }
    if trial_ends_at is not None:
        payload["trial"] = {
            "status": "active",
            "daysGranted": DEFAULT_TRIAL_DAYS,
            "endsAt": trial_ends_at.isoformat(),
        }
    if acceptance.get("billing_status"):
        payload["billingStatus"] = acceptance["billing_status"]
    if acceptance.get("billing_provider"):
        payload["billingProvider"] = acceptance["billing_provider"]
    if acceptance.get("payment_method_type"):
        payload["paymentMethodType"] = acceptance["payment_method_type"]
    return payload


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
    normalized = _normalize_protocol_path(protocol)

    db = SessionLocal()
    try:
        acceptance = _resolve_acceptance(db, normalized)
        if acceptance is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Aceite contratual não encontrado.",
            )
        plan_change_owner = _plan_change_owner(
            db,
            str(acceptance["acceptance_id"]),
        )
        billing_status = str(acceptance.get("billing_status") or "pending").strip().lower()
        enforcement_enabled = is_billing_enforcement_enabled()
        is_ready = is_billing_ready(db, normalized)
        effective_billing_status = billing_status if not is_ready or billing_status == "ready" else "not_required"
        return {
            "protocol": acceptance["protocol"],
            "plan": acceptance["plan"],
            "billingCycle": acceptance["billing_cycle"],
            "restaurantName": acceptance["restaurant_name"],
            "contractingPartyName": acceptance["contracting_party_name"],
            "email": acceptance["email"],
            "billingStatus": effective_billing_status,
            "billingProvider": acceptance.get("billing_provider"),
            "paymentMethodType": acceptance.get("payment_method_type"),
            "billingEnforcementEnabled": enforcement_enabled,
            "activationEligible": (
                plan_change_owner is None and (not enforcement_enabled or is_ready)
            ),
            "contractPurpose": (
                "plan_change" if plan_change_owner is not None else "new_subscription"
            ),
            "planChangeRestaurantId": (
                str(plan_change_owner) if plan_change_owner is not None else None
            ),
        }
    finally:
        db.close()


@router.post("/{protocol}/activate")
def activate_contract(
    protocol: str,
    payload: ContractActivationRequest,
    admin: dict[str, Any] = Depends(get_current_admin),
):
    normalized = _normalize_protocol_path(protocol)
    clean_reason = payload.reason.strip()
    db = SessionLocal()
    try:
        from ..services.restaurant_provisioning import (
            provision_restaurant_for_contract,
            resolve_activation_acceptance,
        )

        acceptance = resolve_activation_acceptance(db, normalized)
        if acceptance is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Aceite contratual não encontrado.",
            )

        plan_change_owner = _plan_change_owner(
            db,
            str(acceptance["acceptance_id"]),
        )
        if plan_change_owner is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Este aceite pertence a uma mudança comercial de tenant existente "
                    "e não pode provisionar um novo restaurante."
                ),
            )

        existing_tenant_id = acceptance.get("linked_restaurante_id")
        if existing_tenant_id is not None:
            if not contract_fixed_billing_required(db, normalized):
                acceptance["billing_status"] = "not_required"
                acceptance["billing_provider"] = None
                acceptance["payment_method_type"] = None
            return _activation_response(
                acceptance,
                int(existing_tenant_id),
                idempotent=True,
            )

        if is_billing_enforcement_enabled() and not is_billing_ready(db, normalized):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A ativação do restaurante exige forma de pagamento configurada e confirmada (billing ready).",
            )
        billing_setup = get_billing_setup(db, normalized)
        result = provision_restaurant_for_contract(
            db,
            acceptance=acceptance,
            billing_setup=billing_setup,
            actor=str(admin.get("user") or "superadmin"),
            reason=clean_reason,
        )
        latest = resolve_activation_acceptance(db, normalized) or acceptance
        if not contract_fixed_billing_required(db, normalized):
            latest["billing_status"] = "not_required"
            latest["billing_provider"] = None
            latest["payment_method_type"] = None
        invitation_token = result.get("invitation_token")
        admin_user_id = result.get("admin_user_id")
        return _activation_response(
            latest,
            int(result["restaurant_id"]),
            slug=str(result["slug"]),
            admin_id=str(admin_user_id) if admin_user_id is not None else None,
            trial_ends_at=result["trial_ends_at"],
            idempotent=invitation_token is None,
            credential_delivery="outbox_scheduled",
        )
    except HTTPException:
        if db.in_transaction():
            db.rollback()
        raise
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
            plan_change_owner = _plan_change_owner(
                db,
                str(acceptance["acceptance_id"]),
            )

            if plan_change_owner is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        "Este aceite pertence a uma mudança comercial canônica e "
                        "não pode ser vinculado manualmente."
                    ),
                )

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
            current_contract = (
                db.query(RestaurantContractAcceptance)
                .filter(RestaurantContractAcceptance.restaurante_id == tenant_id)
                .order_by(
                    RestaurantContractAcceptance.linked_at.desc(),
                    RestaurantContractAcceptance.id.desc(),
                )
                .first()
            )
            if current_contract is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        "Este restaurante já possui autoridade contratual vinculada. "
                        "Substituições devem usar o fluxo canônico de mudança de plano/termos."
                    ),
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
