from __future__ import annotations

import datetime
import logging
import re
import unicodedata
import uuid
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from ..contract_models import ContractAcceptance, RestaurantContractAcceptance
from ..database import SessionLocal, tenant_session_scope
from ..models import ConfiguracaoRestaurante, Restaurante, SuperAdminAuditLog, Usuario
from ..services.contract_notifications import schedule_customer_activation_notification
from ..subscription import VALID_SUBSCRIPTION_PLANS
from .super_admin import get_current_admin
from .super_admin_onboarding import (
    DEFAULT_TRIAL_DAYS,
    _lock_onboarding_transaction,
    _reserve_restaurant_id,
    _slug_owner_id,
    restaurant_trials,
)


logger = logging.getLogger("koma.super_admin.contracts")
router = APIRouter(prefix="/contracts", tags=["SuperAdmin Contracts"])
_PROTOCOL_RE = re.compile(r"^KOMA-CTR-\d{8}-[A-F0-9]{12}$")
INVITATION_TTL_HOURS = 72


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


def _activation_slug(restaurant_name: str, protocol: str) -> str:
    ascii_name = unicodedata.normalize("NFKD", restaurant_name).encode("ascii", "ignore").decode("ascii")
    base = re.sub(r"[^a-z0-9]+", "-", ascii_name.lower()).strip("-") or "restaurante"
    suffix = protocol.rsplit("-", 1)[-1].lower()
    max_base_length = max(1, 100 - len(suffix) - 1)
    trimmed = base[:max_base_length].rstrip("-") or "restaurante"
    return f"{trimmed}-{suffix}"


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


def _resolve_activation_acceptance(db, protocol: str) -> dict[str, Any] | None:
    if db.get_bind().dialect.name == "postgresql":
        row = db.execute(
            text(
                "SELECT * FROM koma_internal.resolve_contract_acceptance_for_activation(:protocol)"
            ),
            {"protocol": protocol},
        ).mappings().one_or_none()
        return dict(row) if row else None

    row = (
        db.query(ContractAcceptance, RestaurantContractAcceptance)
        .outerjoin(
            RestaurantContractAcceptance,
            RestaurantContractAcceptance.acceptance_id == ContractAcceptance.id,
        )
        .filter(ContractAcceptance.protocol == protocol)
        .one_or_none()
    )
    if row is None:
        return None
    acceptance, link = row
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


@router.post("/{protocol}/activate")
def activate_contract(
    protocol: str,
    payload: ContractActivationRequest,
    background_tasks: BackgroundTasks,
    admin: dict[str, Any] = Depends(get_current_admin),
):
    normalized = _normalize_protocol_path(protocol)
    clean_reason = payload.reason.strip()
    db = SessionLocal()
    tenant_id: int | None = None

    try:
        acceptance = _resolve_activation_acceptance(db, normalized)
        if acceptance is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Aceite contratual não encontrado.",
            )

        existing_tenant_id = acceptance.get("linked_restaurante_id")
        if existing_tenant_id is not None:
            return _activation_response(
                acceptance,
                int(existing_tenant_id),
                idempotent=True,
            )

        plan = str(acceptance.get("plan") or "").strip().lower()
        if plan not in VALID_SUBSCRIPTION_PLANS:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="O plano congelado no aceite não é provisionável.",
            )

        restaurant_name = str(acceptance.get("restaurant_name") or "").strip()
        admin_name = str(acceptance.get("representative_name") or acceptance.get("contracting_party_name") or "").strip()
        admin_email = str(acceptance.get("email") or "").strip().lower()
        admin_phone = str(acceptance.get("phone") or "").strip() or None
        if len(restaurant_name) < 2 or len(admin_name) < 2:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="O aceite não contém dados suficientes para provisionamento automático.",
            )
        if not admin_email or "@" not in admin_email or len(admin_email) > 100:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="O e-mail do representante não é compatível com o cadastro de administrador.",
            )

        tenant_id = _reserve_restaurant_id(db)
        slug = _activation_slug(restaurant_name, normalized)

        with tenant_session_scope(db, tenant_id):
            _lock_onboarding_transaction(db)

            latest = _resolve_activation_acceptance(db, normalized)
            if latest is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Aceite contratual não encontrado.",
                )
            if latest.get("linked_restaurante_id") is not None:
                return _activation_response(
                    latest,
                    int(latest["linked_restaurante_id"]),
                    idempotent=True,
                )

            if _slug_owner_id(db, slug) is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="O subdomínio determinístico desta contratação já está em uso.",
                )

            now = datetime.datetime.now(datetime.timezone.utc)
            trial_ends_at = now + datetime.timedelta(days=DEFAULT_TRIAL_DAYS)
            invitation_token = str(uuid.uuid4())

            restaurant = Restaurante(
                id=tenant_id,
                nome=restaurant_name,
                slug=slug,
                plano=plan,
                saas_status="active",
            )
            db.add(restaurant)
            db.flush()

            db.execute(
                restaurant_trials.insert().values(
                    restaurante_id=tenant_id,
                    trial_started_at=now,
                    trial_ends_at=trial_ends_at,
                    trial_status="active",
                    created_at=now,
                    updated_at=now,
                )
            )

            db.add(
                ConfiguracaoRestaurante(
                    restaurante_id=tenant_id,
                    impressao_nome_restaurante=restaurant_name,
                )
            )

            initial_admin = Usuario(
                restaurante_id=tenant_id,
                nome=admin_name,
                telefone=admin_phone,
                email=admin_email,
                cargo="admin",
                status="pendente_ativacao",
                senha_hash=None,
                token_convite=invitation_token,
                token_expira_em=now + datetime.timedelta(hours=INVITATION_TTL_HOURS),
            )
            db.add(initial_admin)
            db.flush()

            link = RestaurantContractAcceptance(
                id=str(uuid.uuid4()),
                restaurante_id=tenant_id,
                acceptance_id=str(acceptance["acceptance_id"]),
                linked_at=now,
            )
            db.add(link)
            db.add(
                SuperAdminAuditLog(
                    restaurante_id=tenant_id,
                    actor=str(admin.get("user") or "superadmin"),
                    action="SUPERADMIN_CONTRACT_ACTIVATE",
                    reason=clean_reason,
                    before_data=None,
                    after_data={
                        "protocol": normalized,
                        "acceptance_id": str(acceptance["acceptance_id"]),
                        "restaurante_id": tenant_id,
                        "slug": slug,
                        "plan": plan,
                        "billing_cycle": acceptance["billing_cycle"],
                        "trial_status": "active",
                        "trial_days": DEFAULT_TRIAL_DAYS,
                        "trial_ends_at": trial_ends_at.isoformat(),
                        "admin_user_id": initial_admin.id,
                        "admin_email": admin_email,
                        "admin_status": "pendente_ativacao",
                        "credential_delivery": "whatsapp_scheduled",
                        "mercado_pago": "disconnected",
                    },
                )
            )
            db.commit()

            # The tenant and contract link are already durable at this point. Any
            # WhatsApp failure stays outside the critical provisioning transaction.
            if admin_phone:
                schedule_customer_activation_notification(
                    background_tasks,
                    phone=admin_phone,
                    representative_name=admin_name,
                    restaurant_name=restaurant_name,
                    protocol=normalized,
                    invitation_token=invitation_token,
                    invitation_ttl_hours=INVITATION_TTL_HOURS,
                )

            logger.info(
                "SUPERADMIN CONTRACT ACTIVATED tenant=%s protocol=%s actor=%s plan=%s",
                tenant_id,
                normalized,
                admin.get("user"),
                plan,
            )
            return _activation_response(
                acceptance,
                tenant_id,
                slug=slug,
                admin_id=str(initial_admin.id),
                trial_ends_at=trial_ends_at,
                idempotent=False,
                credential_delivery="whatsapp_scheduled",
            )
    except HTTPException:
        if db.in_transaction():
            db.rollback()
        raise
    except IntegrityError as exc:
        if db.in_transaction():
            db.rollback()
        logger.warning(
            "SUPERADMIN CONTRACT ACTIVATE CONFLICT tenant=%s protocol=%s actor=%s",
            tenant_id,
            normalized,
            admin.get("user"),
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A contratação já foi ativada ou algum identificador de provisionamento já está em uso.",
        ) from exc
    except Exception as exc:
        if db.in_transaction():
            db.rollback()
        logger.exception(
            "SUPERADMIN CONTRACT ACTIVATE FAILED tenant=%s protocol=%s actor=%s",
            tenant_id,
            normalized,
            admin.get("user"),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Falha ao ativar a contratação. Nenhuma criação parcial foi mantida.",
        ) from exc
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
