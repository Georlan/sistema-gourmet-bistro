from __future__ import annotations

import datetime
import hashlib
import hmac
import json
import re
import secrets
import uuid
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import insert, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import settings
from ..contract_models import ContractAcceptance, RestaurantContractAcceptance
from ..contract_validation import is_valid_cpf, normalize_tax_id, tax_id_kind
from ..crypt import decrypt_field, encrypt_field
from ..database import SessionLocal, get_db, require_tenant_id
from ..legal_config import (
    LEGAL_SOURCE_BLOB_SHA,
    LEGAL_SOURCE_COMMIT,
    LEGAL_VERSION,
    get_legal_provider_identity,
)
from ..models import Usuario
from ..security import get_current_user
from ..subscription import (
    VALID_SUBSCRIPTION_PLANS,
    subscription_annual_monthly_equivalent,
    subscription_annual_total,
    subscription_marketplace_rate,
    subscription_monthly_price,
)


router = APIRouter(prefix="/api/contracts", tags=["Contratos eletrônicos"])
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_EXPECTED_DOCUMENTS = {
    "terms": "termos",
    "commercial": "planos",
    "dpa": "dpa",
    "privacy": "privacidade",
}


class ContractAcceptanceRequest(BaseModel):
    request_id: str = Field(min_length=36, max_length=36)
    contracting_party_name: str = Field(min_length=2, max_length=255)
    contracting_party_tax_id: str = Field(min_length=11, max_length=32)
    restaurant_name: str = Field(min_length=2, max_length=255)
    representative_name: str = Field(min_length=2, max_length=255)
    representative_tax_id: str = Field(min_length=11, max_length=32)
    representative_role: str = Field(min_length=2, max_length=100)
    email: str = Field(min_length=3, max_length=255)
    phone: str = Field(min_length=8, max_length=50)
    plan: str = Field(min_length=2, max_length=20)
    billing_cycle: str = Field(min_length=5, max_length=16)
    powers_declared: bool
    legal_version: str = Field(min_length=1, max_length=16)
    legal_source_commit: str = Field(min_length=40, max_length=40)
    legal_source_blob_sha: str = Field(min_length=40, max_length=40)
    documents: dict[str, dict[str, Any]]

    model_config = ConfigDict(extra="forbid")

    @field_validator("request_id")
    @classmethod
    def validate_request_id(cls, value: str) -> str:
        try:
            return str(uuid.UUID(value))
        except ValueError as exc:
            raise ValueError("request_id deve ser UUID válido") from exc

    @field_validator("plan")
    @classmethod
    def validate_plan(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in VALID_SUBSCRIPTION_PLANS:
            raise ValueError("Plano inválido")
        return normalized

    @field_validator("billing_cycle")
    @classmethod
    def validate_billing_cycle(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in {"mensal", "anual"}:
            raise ValueError("Ciclo de cobrança inválido")
        return normalized

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not _EMAIL_RE.fullmatch(normalized):
            raise ValueError("Informe um e-mail válido")
        return normalized


def _clean_text(value: str) -> str:
    return " ".join(value.strip().split())


def _canonical_document(document: dict[str, Any]) -> str:
    return json.dumps(
        document,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def _document_hash(snapshot: str) -> str:
    return hashlib.sha256(snapshot.encode("utf-8")).hexdigest()


def _evidence_hash(value: str) -> str:
    return hmac.new(
        settings.SECRET_KEY.encode("utf-8"),
        value.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def _resolve_source_ip(request: Request) -> tuple[str, str]:
    cloudflare_ip = (request.headers.get("cf-connecting-ip") or "").strip()
    if cloudflare_ip:
        return cloudflare_ip[:128], "cf-connecting-ip"

    forwarded = (request.headers.get("x-forwarded-for") or "").strip()
    if forwarded:
        first = forwarded.split(",", 1)[0].strip()
        if first:
            return first[:128], "x-forwarded-for"

    client = request.client.host if request.client else "unknown"
    return str(client)[:128], "direct"


def _validate_legal_bundle(payload: ContractAcceptanceRequest) -> dict[str, str]:
    if payload.legal_version != LEGAL_VERSION:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A versão jurídica exibida ficou desatualizada. Recarregue a página.",
        )
    if (
        payload.legal_source_commit != LEGAL_SOURCE_COMMIT
        or payload.legal_source_blob_sha != LEGAL_SOURCE_BLOB_SHA
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A origem dos documentos jurídicos não corresponde à versão vigente.",
        )
    if set(payload.documents) != set(_EXPECTED_DOCUMENTS):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Pacote jurídico incompleto.",
        )

    snapshots: dict[str, str] = {}
    for key, expected_slug in _EXPECTED_DOCUMENTS.items():
        document = payload.documents.get(key)
        if not isinstance(document, dict):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Documento jurídico inválido: {key}.",
            )
        if document.get("slug") != expected_slug or document.get("version") != LEGAL_VERSION:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Documento jurídico desatualizado: {expected_slug}.",
            )
        snapshots[key] = _canonical_document(document)
    return snapshots


def _serialize_money(value: Decimal | None) -> str | None:
    if value is None:
        return None
    return f"{value.quantize(Decimal('0.01')):.2f}"


def _serialize_rate(value: Decimal) -> str:
    return f"{value.quantize(Decimal('0.000001')):.6f}"


def _protocol(now: datetime.datetime) -> str:
    return f"KOMA-CTR-{now:%Y%m%d}-{secrets.token_hex(6).upper()}"


def _receipt_from_row(row: ContractAcceptance) -> dict[str, Any]:
    raw = decrypt_field(row.receipt_snapshot_encrypted)
    return json.loads(raw)


@router.post("/accept", status_code=status.HTTP_201_CREATED)
def accept_contract(payload: ContractAcceptanceRequest, request: Request):
    if not payload.powers_declared:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="A declaração de poderes para contratar é obrigatória.",
        )

    contracting_tax_id = normalize_tax_id(payload.contracting_party_tax_id)
    contracting_kind = tax_id_kind(contracting_tax_id)
    if contracting_kind is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="CPF/CNPJ do contratante inválido.",
        )

    representative_tax_id = normalize_tax_id(payload.representative_tax_id)
    if not is_valid_cpf(representative_tax_id):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="CPF do representante inválido.",
        )

    snapshots = _validate_legal_bundle(payload)
    hashes = {key: _document_hash(value) for key, value in snapshots.items()}

    try:
        provider = get_legal_provider_identity()
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Identificação jurídica do prestador ainda não está configurada para emitir o comprovante.",
        ) from exc

    now = datetime.datetime.now(datetime.timezone.utc)
    local_now = now.astimezone(ZoneInfo("America/Fortaleza"))
    protocol = _protocol(now)
    acceptance_id = str(uuid.uuid4())
    source_ip, ip_source = _resolve_source_ip(request)
    user_agent = (request.headers.get("user-agent") or "não informado").strip()[:1024]

    fixed_monthly_price = subscription_monthly_price(payload.plan)
    marketplace_rate = subscription_marketplace_rate(payload.plan)
    if payload.billing_cycle == "anual":
        billing_amount = subscription_annual_total(payload.plan)
        annual_monthly_equivalent = subscription_annual_monthly_equivalent(payload.plan)
    else:
        billing_amount = fixed_monthly_price
        annual_monthly_equivalent = None

    receipt: dict[str, Any] = {
        "protocol": protocol,
        "acceptedAtUtc": now.isoformat(),
        "acceptedAtBrasilia": local_now.isoformat(),
        "provider": {
            "name": provider.name,
            "taxId": provider.tax_id,
            "address": provider.address,
            "location": provider.location,
        },
        "contractingParty": {
            "name": _clean_text(payload.contracting_party_name),
            "taxId": contracting_tax_id,
            "taxIdKind": contracting_kind,
            "restaurantName": _clean_text(payload.restaurant_name),
            "email": payload.email,
            "phone": _clean_text(payload.phone),
        },
        "representative": {
            "name": _clean_text(payload.representative_name),
            "taxId": representative_tax_id,
            "role": _clean_text(payload.representative_role),
            "powersDeclared": True,
        },
        "commercial": {
            "plan": payload.plan,
            "billingCycle": payload.billing_cycle,
            "fixedMonthlyPrice": _serialize_money(fixed_monthly_price),
            "billingAmount": _serialize_money(billing_amount),
            "annualMonthlyEquivalent": _serialize_money(annual_monthly_equivalent),
            "marketplaceRate": _serialize_rate(marketplace_rate),
            "trialDays": 7,
            "trialWaivesFixedFeeOnly": True,
        },
        "documents": {
            "version": LEGAL_VERSION,
            "terms": {"slug": "termos", "hash": hashes["terms"]},
            "commercial": {"slug": "planos", "hash": hashes["commercial"]},
            "dpa": {"slug": "dpa", "hash": hashes["dpa"]},
            "privacy": {"slug": "privacidade", "hash": hashes["privacy"]},
            "sourceCommit": LEGAL_SOURCE_COMMIT,
            "sourceBlobSha": LEGAL_SOURCE_BLOB_SHA,
        },
        "evidence": {
            "requestId": payload.request_id,
            "sourceIp": source_ip,
            "ipSource": ip_source,
            "sourceIpHash": _evidence_hash(source_ip),
            "userAgent": user_agent,
            "userAgentHash": _evidence_hash(user_agent),
        },
        "provisioning": {
            "status": "pending",
            "message": "Aceite registrado. O tenant será vinculado a este protocolo no provisionamento.",
        },
    }

    values = {
        "id": acceptance_id,
        "protocol": protocol,
        "request_id": payload.request_id,
        "contracting_party_name": _clean_text(payload.contracting_party_name),
        "contracting_party_tax_id_encrypted": encrypt_field(contracting_tax_id),
        "contracting_party_tax_id_last4": contracting_tax_id[-4:],
        "restaurant_name": _clean_text(payload.restaurant_name),
        "representative_name": _clean_text(payload.representative_name),
        "representative_tax_id_encrypted": encrypt_field(representative_tax_id),
        "representative_tax_id_last4": representative_tax_id[-4:],
        "representative_role": _clean_text(payload.representative_role),
        "email": payload.email,
        "phone": _clean_text(payload.phone),
        "plan": payload.plan,
        "billing_cycle": payload.billing_cycle,
        "fixed_monthly_price": fixed_monthly_price,
        "billing_amount": billing_amount,
        "annual_monthly_equivalent": annual_monthly_equivalent,
        "marketplace_rate": marketplace_rate,
        "legal_version": LEGAL_VERSION,
        "terms_hash": hashes["terms"],
        "commercial_hash": hashes["commercial"],
        "dpa_hash": hashes["dpa"],
        "privacy_hash": hashes["privacy"],
        "terms_snapshot": snapshots["terms"],
        "commercial_snapshot": snapshots["commercial"],
        "dpa_snapshot": snapshots["dpa"],
        "privacy_snapshot": snapshots["privacy"],
        "legal_source_commit": LEGAL_SOURCE_COMMIT,
        "legal_source_blob_sha": LEGAL_SOURCE_BLOB_SHA,
        "powers_declared": True,
        "accepted_at": now,
        "source_ip_encrypted": encrypt_field(source_ip),
        "source_ip_hash": _evidence_hash(source_ip),
        "user_agent": user_agent,
        "user_agent_hash": _evidence_hash(user_agent),
        "receipt_snapshot_encrypted": encrypt_field(
            json.dumps(receipt, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        ),
    }

    db = SessionLocal()
    try:
        # Core INSERT sem RETURNING: o runtime de produção recebe apenas INSERT
        # na tabela global de evidências e não ganha SELECT cross-tenant.
        db.execute(insert(ContractAcceptance.__table__).values(**values))
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Esta tentativa de aceite já foi registrada. Recarregue a página antes de tentar novamente.",
        ) from exc
    finally:
        db.close()

    return {
        "protocol": protocol,
        "acceptedAt": now.isoformat(),
        "receipt": receipt,
        "message": "Aceite eletrônico registrado com sucesso.",
    }


@router.get("/current")
def get_current_contract(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    if current_user.cargo not in {"admin", "gerente"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Somente administradores e gerentes podem consultar o contrato do restaurante.",
        )

    tenant_id = require_tenant_id()
    row: dict[str, Any] | None = None

    if db.get_bind().dialect.name == "postgresql":
        row = db.execute(
            text("SELECT * FROM koma_internal.current_contract_receipt()")
        ).mappings().one_or_none()
        if row is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Nenhum aceite contratual está vinculado a este restaurante.",
            )
        encrypted_receipt = row["receipt_snapshot_encrypted"]
    else:
        link = (
            db.query(RestaurantContractAcceptance)
            .filter(RestaurantContractAcceptance.restaurante_id == tenant_id)
            .order_by(RestaurantContractAcceptance.linked_at.desc())
            .first()
        )
        if link is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Nenhum aceite contratual está vinculado a este restaurante.",
            )
        acceptance = db.get(ContractAcceptance, link.acceptance_id)
        if acceptance is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Evidência contratual não encontrada.",
            )
        encrypted_receipt = acceptance.receipt_snapshot_encrypted

    raw = decrypt_field(encrypted_receipt)
    return {
        "receipt": json.loads(raw),
        "tenantId": tenant_id,
    }
