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

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import insert, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import settings
from ..contract_models import ContractAcceptance, ContractInvite, RestaurantContractAcceptance
from ..contract_validation import is_valid_cpf, normalize_tax_id, tax_id_kind
from ..crypt import decrypt_field, encrypt_field
from ..database import SessionLocal, get_db, require_tenant_id, tenant_session_scope
from ..legal_config import (
    LEGAL_SOURCE_BLOB_SHA,
    LEGAL_SOURCE_COMMIT,
    LEGAL_VERSION,
    get_legal_provider_identity,
)
from ..models import Restaurante, SuperAdminAuditLog, Usuario
from ..saas_billing_models import SaaSSubscription
from ..security import IPRateLimiter, get_current_user
from ..subscription import (
    COMMERCIAL_PRICING_VERSION,
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
_accept_contract_rate_limiter = IPRateLimiter(requests_per_minute=6)


class ContractAcceptanceRequest(BaseModel):
    signup_token: str | None = Field(default=None, max_length=128)
    request_id: str = Field(min_length=36, max_length=36)
    contracting_party_name: str = Field(min_length=2, max_length=255)
    contracting_party_tax_id: str = Field(min_length=11, max_length=32)
    restaurant_name: str = Field(min_length=2, max_length=255)
    representative_name: str = Field(min_length=2, max_length=255)
    representative_tax_id: str = Field(min_length=11, max_length=32)
    representative_role: str = Field(min_length=2, max_length=100)
    email: str = Field(min_length=3, max_length=100)
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


class ContractInviteAcceptRequest(BaseModel):
    token: str = Field(min_length=16, max_length=256)
    request_id: str = Field(min_length=36, max_length=36)
    contracting_party_name: str = Field(min_length=2, max_length=255)
    contracting_party_tax_id: str = Field(min_length=11, max_length=32)
    restaurant_name: str = Field(min_length=2, max_length=255)
    representative_name: str = Field(min_length=2, max_length=255)
    representative_tax_id: str = Field(min_length=11, max_length=32)
    representative_role: str = Field(min_length=2, max_length=100)
    email: str = Field(min_length=3, max_length=100)
    phone: str = Field(min_length=8, max_length=50)
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

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not _EMAIL_RE.fullmatch(normalized):
            raise ValueError("Informe um e-mail válido")
        return normalized


def _as_utc(dt: datetime.datetime) -> datetime.datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=datetime.timezone.utc)
    return dt.astimezone(datetime.timezone.utc)


def _hash_invite_token(token: str) -> str:
    return hashlib.sha256(token.strip().encode("utf-8")).hexdigest()


def _parse_invite_token(token: str) -> int:
    raw = token.strip()
    if "." not in raw:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Link de aceite contratual inválido.",
        )
    prefix, secret = raw.split(".", 1)
    if not prefix.isdigit() or not secret or len(secret) < 16:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Link de aceite contratual inválido.",
        )
    tenant_id = int(prefix)
    if tenant_id <= 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Link de aceite contratual inválido.",
        )
    return tenant_id


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


def _build_contract_acceptance_record(
    *,
    request: Request,
    request_id: str,
    contracting_party_name: str,
    contracting_party_tax_id: str,
    restaurant_name_input: str,
    representative_name_input: str,
    representative_tax_id_input: str,
    representative_role: str,
    email: str,
    phone_input: str,
    plan: str,
    billing_cycle: str,
    powers_declared: bool,
    legal_version: str,
    legal_source_commit: str,
    legal_source_blob_sha: str,
    documents: dict[str, dict[str, Any]],
    provisioning_status: str = "pending",
    provisioning_message: str = "Aceite registrado. O tenant será vinculado a este protocolo no provisionamento.",
) -> tuple[str, str, datetime.datetime, dict[str, Any], dict[str, Any], str, str, str, str]:
    if not powers_declared:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="A declaração de poderes para contratar é obrigatória.",
        )

    contracting_tax_id = normalize_tax_id(contracting_party_tax_id)
    contracting_kind = tax_id_kind(contracting_tax_id)
    if contracting_kind is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="CPF/CNPJ do contratante inválido.",
        )

    representative_tax_id = normalize_tax_id(representative_tax_id_input)
    if not is_valid_cpf(representative_tax_id):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="CPF do representante inválido.",
        )

    class _BundleView:
        pass

    bundle_proxy = _BundleView()
    bundle_proxy.legal_version = legal_version  # type: ignore[attr-defined]
    bundle_proxy.legal_source_commit = legal_source_commit  # type: ignore[attr-defined]
    bundle_proxy.legal_source_blob_sha = legal_source_blob_sha  # type: ignore[attr-defined]
    bundle_proxy.documents = documents  # type: ignore[attr-defined]
    snapshots = _validate_legal_bundle(bundle_proxy)  # type: ignore[arg-type]
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

    fixed_monthly_price = subscription_monthly_price(plan)
    marketplace_rate = subscription_marketplace_rate(plan)
    if billing_cycle == "anual":
        billing_amount = subscription_annual_total(plan)
        annual_monthly_equivalent = subscription_annual_monthly_equivalent(plan)
    else:
        billing_amount = fixed_monthly_price
        annual_monthly_equivalent = None

    restaurant_name = _clean_text(restaurant_name_input)
    representative_name = _clean_text(representative_name_input)
    phone = _clean_text(phone_input)

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
            "name": _clean_text(contracting_party_name),
            "taxId": contracting_tax_id,
            "taxIdKind": contracting_kind,
            "restaurantName": restaurant_name,
            "email": email,
            "phone": phone,
        },
        "representative": {
            "name": representative_name,
            "taxId": representative_tax_id,
            "role": _clean_text(representative_role),
            "powersDeclared": True,
        },
        "commercial": {
            "pricingVersion": COMMERCIAL_PRICING_VERSION,
            "plan": plan,
            "billingCycle": billing_cycle,
            "fixedMonthlyPrice": _serialize_money(fixed_monthly_price),
            "billingAmount": _serialize_money(billing_amount),
            "annualMonthlyEquivalent": _serialize_money(annual_monthly_equivalent),
            "marketplaceRate": _serialize_rate(marketplace_rate),
            "fixedBillingRequired": billing_amount > 0,
            "trialDays": 0 if billing_amount == 0 else 7,
            "trialWaivesFixedFeeOnly": billing_amount > 0,
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
            "requestId": request_id,
            "sourceIp": source_ip,
            "ipSource": ip_source,
            "sourceIpHash": _evidence_hash(source_ip),
            "userAgent": user_agent,
            "userAgentHash": _evidence_hash(user_agent),
        },
        "provisioning": {
            "status": provisioning_status,
            "message": provisioning_message,
        },
    }

    values = {
        "id": acceptance_id,
        "protocol": protocol,
        "request_id": request_id,
        "contracting_party_name": _clean_text(contracting_party_name),
        "contracting_party_tax_id_encrypted": encrypt_field(contracting_tax_id),
        "contracting_party_tax_id_last4": contracting_tax_id[-4:],
        "restaurant_name": restaurant_name,
        "representative_name": representative_name,
        "representative_tax_id_encrypted": encrypt_field(representative_tax_id),
        "representative_tax_id_last4": representative_tax_id[-4:],
        "representative_role": _clean_text(representative_role),
        "email": email,
        "phone": phone,
        "plan": plan,
        "billing_cycle": billing_cycle,
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
    return acceptance_id, protocol, now, receipt, values, restaurant_name, representative_name, email, phone


@router.post("/accept", status_code=status.HTTP_201_CREATED)
def accept_contract(
    payload: ContractAcceptanceRequest,
    request: Request,
    background_tasks: BackgroundTasks,
):
    _accept_contract_rate_limiter.check(request)

    (
        _acceptance_id,
        protocol,
        now,
        receipt,
        values,
        restaurant_name,
        representative_name,
        email,
        phone,
    ) = _build_contract_acceptance_record(
        request=request,
        request_id=payload.request_id,
        contracting_party_name=payload.contracting_party_name,
        contracting_party_tax_id=payload.contracting_party_tax_id,
        restaurant_name_input=payload.restaurant_name,
        representative_name_input=payload.representative_name,
        representative_tax_id_input=payload.representative_tax_id,
        representative_role=payload.representative_role,
        email=payload.email,
        phone_input=payload.phone,
        plan=payload.plan,
        billing_cycle=payload.billing_cycle,
        powers_declared=payload.powers_declared,
        legal_version=payload.legal_version,
        legal_source_commit=payload.legal_source_commit,
        legal_source_blob_sha=payload.legal_source_blob_sha,
        documents=payload.documents,
    )

    db = SessionLocal()
    try:
        if payload.signup_token:
            from .signups import require_signup, signup_receipt
            signup = require_signup(db, payload.signup_token)
            if signup["id"] != payload.request_id:
                raise HTTPException(409, "Inscrição incompatível com esta contratação.")
            prior = signup_receipt(db, signup["id"])
            if prior:
                prior_receipt = json.loads(decrypt_field(prior))
                return {"protocol": prior_receipt["protocol"], "receipt": prior_receipt, "message": "Aceite já registrado."}
        # Core INSERT sem RETURNING: o runtime de produção recebe apenas INSERT
        # na tabela global de evidências e não ganha SELECT cross-tenant.
        db.execute(insert(ContractAcceptance.__table__).values(**values))
        from ..services.signup_notifications import enqueue_acceptance
        enqueue_acceptance(db, protocol=protocol, restaurant_name=restaurant_name, representative_name=representative_name, email=payload.email, phone=phone)
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

    document_snapshots: dict[str, str] = {}

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

        document_row = db.execute(
            text("SELECT * FROM koma_internal.current_contract_documents()")
        ).mappings().one_or_none()
        if (
            document_row is None
            or str(document_row.get("protocol") or "") != str(row.get("protocol") or "")
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Os snapshots jurídicos vinculados ao contrato estão indisponíveis.",
            )
        document_snapshots = {
            "terms": str(document_row["terms_snapshot"]),
            "commercial": str(document_row["commercial_snapshot"]),
            "dpa": str(document_row["dpa_snapshot"]),
            "privacy": str(document_row["privacy_snapshot"]),
        }
    else:
        link = (
            db.query(RestaurantContractAcceptance)
            .filter(RestaurantContractAcceptance.restaurante_id == tenant_id)
            .order_by(
                RestaurantContractAcceptance.linked_at.desc(),
                RestaurantContractAcceptance.id.desc(),
            )
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
        document_snapshots = {
            "terms": str(acceptance.terms_snapshot),
            "commercial": str(acceptance.commercial_snapshot),
            "dpa": str(acceptance.dpa_snapshot),
            "privacy": str(acceptance.privacy_snapshot),
        }

    try:
        receipt = json.loads(decrypt_field(encrypted_receipt))
        receipt_documents = receipt["documents"]
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="O comprovante contratual vinculado está inválido.",
        ) from exc

    accepted_documents: dict[str, dict[str, Any]] = {}
    for key, snapshot in document_snapshots.items():
        expected = receipt_documents.get(key) or {}
        expected_hash = str(expected.get("hash") or "")
        if not expected_hash or _document_hash(snapshot) != expected_hash:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Integridade do snapshot jurídico inválida: {key}.",
            )
        try:
            document = json.loads(snapshot)
        except (TypeError, ValueError, json.JSONDecodeError) as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Snapshot jurídico inválido: {key}.",
            ) from exc
        if str(document.get("version") or "") != str(receipt_documents.get("version") or ""):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Versão do snapshot jurídico divergente: {key}.",
            )
        accepted_documents[key] = document

    return {
        "receipt": receipt,
        "acceptedDocuments": accepted_documents,
        "tenantId": tenant_id,
    }


def _load_active_invite(db: Session, tenant_id: int, token_hash: str) -> tuple[ContractInvite, Restaurante]:
    invite = (
        db.query(ContractInvite)
        .filter(
            ContractInvite.restaurante_id == tenant_id,
            ContractInvite.token_hash == token_hash,
        )
        .one_or_none()
    )
    if invite is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Link de aceite contratual não encontrado.",
        )
    if invite.used_at is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Este link de aceite já foi utilizado.",
        )
    now = datetime.datetime.now(datetime.timezone.utc)
    if _as_utc(invite.expires_at) <= now:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Este link de aceite expirou. Solicite um novo link ao suporte.",
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
    existing_contract = (
        db.query(RestaurantContractAcceptance.id)
        .filter(RestaurantContractAcceptance.restaurante_id == tenant_id)
        .first()
    )
    if existing_contract is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Este restaurante já possui contrato vinculado.",
        )
    return invite, restaurant


@router.get("/invite")
def get_contract_invite(
    request: Request,
    token: str = Query(..., min_length=16, max_length=256),
):
    _accept_contract_rate_limiter.check(request)
    tenant_id = _parse_invite_token(token)
    token_hash = _hash_invite_token(token)

    db = SessionLocal()
    try:
        with tenant_session_scope(db, tenant_id):
            invite, restaurant = _load_active_invite(db, tenant_id, token_hash)
            return {
                "restaurantId": str(restaurant.id),
                "restaurantName": restaurant.nome,
                "plan": invite.plan,
                "billingCycle": invite.billing_cycle,
                "expiresAt": _as_utc(invite.expires_at).isoformat(),
                "legalVersion": LEGAL_VERSION,
                "legalSourceCommit": LEGAL_SOURCE_COMMIT,
                "legalSourceBlobSha": LEGAL_SOURCE_BLOB_SHA,
            }
    finally:
        db.close()


@router.post("/invite/accept", status_code=status.HTTP_201_CREATED)
def accept_contract_invite(
    payload: ContractInviteAcceptRequest,
    request: Request,
):
    _accept_contract_rate_limiter.check(request)
    tenant_id = _parse_invite_token(payload.token)
    token_hash = _hash_invite_token(payload.token)

    db = SessionLocal()
    try:
        with tenant_session_scope(db, tenant_id):
            invite, restaurant = _load_active_invite(db, tenant_id, token_hash)
            if str(restaurant.plano or "").strip().lower() != str(invite.plan).strip().lower():
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="O plano do restaurante foi alterado após a emissão deste link. Solicite um novo link.",
                )

            (
                acceptance_id,
                protocol,
                now,
                receipt,
                values,
                restaurant_name,
                representative_name,
                email,
                phone,
            ) = _build_contract_acceptance_record(
                request=request,
                request_id=payload.request_id,
                contracting_party_name=payload.contracting_party_name,
                contracting_party_tax_id=payload.contracting_party_tax_id,
                restaurant_name_input=payload.restaurant_name,
                representative_name_input=payload.representative_name,
                representative_tax_id_input=payload.representative_tax_id,
                representative_role=payload.representative_role,
                email=payload.email,
                phone_input=payload.phone,
                plan=invite.plan,
                billing_cycle=invite.billing_cycle,
                powers_declared=payload.powers_declared,
                legal_version=payload.legal_version,
                legal_source_commit=payload.legal_source_commit,
                legal_source_blob_sha=payload.legal_source_blob_sha,
                documents=payload.documents,
                provisioning_status="linked",
                provisioning_message="Aceite registrado via link único e vinculado automaticamente ao restaurante.",
            )

            consumed = db.execute(
                update(ContractInvite)
                .where(
                    ContractInvite.id == invite.id,
                    ContractInvite.restaurante_id == tenant_id,
                    ContractInvite.used_at.is_(None),
                )
                .values(
                    used_at=now,
                    acceptance_id=acceptance_id,
                    protocol=protocol,
                )
            )
            if consumed.rowcount != 1:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Este link de aceite já foi utilizado.",
                )

            db.execute(insert(ContractAcceptance.__table__).values(**values))
            db.add(
                RestaurantContractAcceptance(
                    id=str(uuid.uuid4()),
                    restaurante_id=tenant_id,
                    acceptance_id=acceptance_id,
                    linked_at=now,
                )
            )

            existing_subscription = (
                db.query(SaaSSubscription)
                .filter(SaaSSubscription.restaurante_id == tenant_id)
                .one_or_none()
            )
            created_subscription = False
            invite_payment_method = getattr(invite, "payment_method_type", None)
            if existing_subscription is None:
                db.add(
                    SaaSSubscription(
                        restaurante_id=tenant_id,
                        provider="mercado_pago",
                        provider_customer_id=None,
                        provider_subscription_id=None,
                        payment_method_type=invite_payment_method,
                        status="onboarding",
                        trial_started_at=None,
                        trial_ends_at=None,
                        billing_cycle=invite.billing_cycle,
                    )
                )
                created_subscription = True
            elif invite_payment_method and not existing_subscription.payment_method_type:
                existing_subscription.payment_method_type = invite_payment_method

            if invite_payment_method == "pix":
                from ..services.billing_service import (
                    link_billing_setup_to_tenant,
                    upsert_billing_setup,
                )

                canonical_cycle = (
                    "annual"
                    if str(invite.billing_cycle or "").strip().lower() in {"annual", "anual"}
                    else "monthly"
                )
                upsert_billing_setup(
                    db,
                    protocol=protocol,
                    contract_acceptance_id=acceptance_id,
                    provider="mercado_pago",
                    payment_method_type="pix",
                    status="ready",
                    billing_cycle=canonical_cycle,
                )
                link_billing_setup_to_tenant(db, protocol, tenant_id)

            subscription_status = (
                "onboarding"
                if created_subscription
                else getattr(existing_subscription, "status", None)
            )

            from ..services.restaurant_provisioning import (
                QA_OPERATION_END,
                clear_operational_qa_cache,
                is_superadmin_operational_qa_active,
            )

            qa_ended = False
            if is_superadmin_operational_qa_active(db, tenant_id):
                db.add(
                    SuperAdminAuditLog(
                        restaurante_id=tenant_id,
                        actor=f"contract_invite:{invite.id}",
                        action=QA_OPERATION_END,
                        reason="Encerramento automático da janela de QA operacional após aceite contratual.",
                        before_data={"qa_active": True},
                        after_data={
                            "mode": "operational_qa",
                            "ended_at": now.isoformat(),
                            "ended_by_contract_protocol": protocol,
                        },
                    )
                )
                qa_ended = True

            db.add(
                SuperAdminAuditLog(
                    restaurante_id=tenant_id,
                    actor=f"contract_invite:{invite.id}",
                    action="CONTRACT_INVITE_ACCEPTED",
                    reason=invite.reason,
                    before_data=None,
                    after_data={
                        "invite_id": invite.id,
                        "protocol": protocol,
                        "acceptance_id": acceptance_id,
                        "plan": invite.plan,
                        "billing_cycle": invite.billing_cycle,
                        "payment_method_type": invite_payment_method,
                        "auto_release_on_accept": bool(getattr(invite, "auto_release_on_accept", False)),
                        "qa_ended": qa_ended,
                        "created_subscription": created_subscription,
                        "subscription_status": subscription_status,
                    },
                )
            )

            from ..services.signup_notifications import enqueue_acceptance
            enqueue_acceptance(
                db,
                protocol=protocol,
                restaurant_name=restaurant_name,
                representative_name=representative_name,
                email=email,
                phone=phone,
            )
            db.commit()
            clear_operational_qa_cache(db, tenant_id)

            auto_released = False
            trial_started = False
            release_pending_reason: str | None = None
            if bool(getattr(invite, "auto_release_on_accept", False)):
                from ..services.onboarding_trial import ensure_trial_started_after_onboarding
                from .onboarding import _build_onboarding_status

                status_snapshot = _build_onboarding_status(db)
                configuration_complete = bool(
                    (status_snapshot.get("readiness") or {}).get("configurationComplete")
                )
                if not configuration_complete:
                    release_pending_reason = "configuration_incomplete"
                else:
                    trial_result = ensure_trial_started_after_onboarding(
                        db,
                        restaurante_id=tenant_id,
                        actor=f"contract_invite:{invite.id}",
                    )
                    if trial_result is not None and trial_result.get("trial_started_at") is not None:
                        subscription_status = str(trial_result.get("status") or "trialing")
                        auto_released = True
                        trial_started = True
                        try:
                            from ..services.signup_notifications import enqueue_trial_started
                            from ..models import Usuario

                            admin_user = (
                                db.query(Usuario)
                                .filter(Usuario.restaurante_id == tenant_id, Usuario.cargo == "admin")
                                .order_by(Usuario.id)
                                .first()
                            )
                            if admin_user is not None:
                                enqueue_trial_started(
                                    db,
                                    tenant_id=tenant_id,
                                    restaurant_name=restaurant_name,
                                    plan=invite.plan,
                                    billing_cycle=invite.billing_cycle,
                                    customer_name=admin_user.nome or representative_name,
                                    customer_email=admin_user.email or email,
                                    customer_phone=admin_user.telefone or phone,
                                    trial_ends_at=trial_result["trial_ends_at"],
                                )
                                db.commit()
                        except Exception:
                            db.rollback()

            return {
                "protocol": protocol,
                "acceptedAt": now.isoformat(),
                "restaurantId": str(tenant_id),
                "restaurantName": restaurant_name,
                "plan": invite.plan,
                "billingCycle": invite.billing_cycle,
                "subscriptionStatus": subscription_status,
                "qaEnded": qa_ended,
                "autoReleased": auto_released,
                "trialStarted": trial_started,
                "releasePendingReason": release_pending_reason,
                "receipt": receipt,
                "message": "Contrato aceito e vinculado ao restaurante com sucesso.",
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
            detail="Este aceite já foi registrado ou o restaurante já possui contrato vinculado.",
        ) from exc
    finally:
        db.close()
