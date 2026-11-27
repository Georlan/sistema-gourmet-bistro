"""Rotas convergentes de provisionamento universal (Público Autônomo + Expresso)."""

from __future__ import annotations

import hmac
import logging
import os
from typing import Any, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..security import IPRateLimiter, create_access_token
from ..services.express_provisioning_parser import parse_express_provisioning_input
from ..services.tenant_id_reuse import MAX_TENANT_ID
from ..services.universal_presets import SUPPORTED_OPERATION_PROFILES
from ..services.universal_provisioning import (
    UniversalProvisioningInput,
    provision_restaurant,
)
from .super_admin import get_current_admin

logger = logging.getLogger("koma.universal_provisioning.routes")
router = APIRouter(prefix="/provisioning", tags=["Provisionamento Universal"])

_public_preview_limiter = IPRateLimiter(requests_per_minute=30)
_public_start_limiter = IPRateLimiter(requests_per_minute=10)


class ProvisioningMenuItemPayload(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    price: float = Field(ge=0, le=100_000)
    category: str = Field(default="Cardápio", min_length=1, max_length=80)
    description: str = Field(default="", max_length=500)

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ProvisioningOperatingHourPayload(BaseModel):
    days: str = Field(min_length=1, max_length=80)
    hours: str = Field(min_length=1, max_length=80)

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class PublicProvisioningPreviewRequest(BaseModel):
    structured_text: str | None = Field(default=None, max_length=25_000)
    name: str | None = Field(default=None, max_length=255)
    subdomain: str | None = Field(default=None, max_length=100)
    plan: str = Field(default="pro", max_length=32)
    operation_profile: str | None = Field(default=None, max_length=64)
    segment_preset: str | None = Field(default=None, max_length=64)
    admin_name: str | None = Field(default=None, max_length=100)
    admin_email: str | None = Field(default=None, max_length=100)
    phone: str | None = Field(default=None, max_length=30)
    address: str | None = Field(default=None, max_length=255)
    order_types: list[Literal["consumo_local", "retirada", "delivery"]] = Field(default_factory=list)
    operating_hours: list[ProvisioningOperatingHourPayload] = Field(default_factory=list)
    apply_segment_preset: bool = True
    menu_text: str | None = Field(default=None, max_length=25_000)
    menu_items: list[ProvisioningMenuItemPayload] = Field(default_factory=list)

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class PublicProvisioningStartRequest(PublicProvisioningPreviewRequest):
    admin_password: str | None = Field(default=None, min_length=8, max_length=72)
    idempotency_key: str | None = Field(default=None, max_length=120)

    @field_validator("admin_password")
    @classmethod
    def validate_password_bytes(cls, value: str | None) -> str | None:
        if value is not None and len(value.encode("utf-8")) > 72:
            raise ValueError("A senha deve possuir no máximo 72 bytes.")
        return value


class ExpressProvisioningRequest(PublicProvisioningStartRequest):
    dry_run: bool = False
    defer_trial: bool = True
    qa_lab: bool = False
    qa_hours: int = Field(default=24, ge=1, le=72)
    restaurant_id: int | None = Field(default=None, ge=1, le=MAX_TENANT_ID)


def get_express_provisioning_principal(
    authorization: str | None = Header(default=None),
    x_provisioning_actor: str | None = Header(default=None, alias="X-Provisioning-Actor"),
) -> dict[str, Any]:
    """Autoriza via sessão Super Admin OU token escopado KOMA_PROVISIONING_API_TOKEN."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token de autenticação obrigatório para provisionamento expresso.",
        )
    raw_token = authorization.split(" ", 1)[1].strip()
    if not raw_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token de autenticação inválido.",
        )

    configured_scoped_token = os.getenv("KOMA_PROVISIONING_API_TOKEN", "").strip()
    if configured_scoped_token and hmac.compare_digest(raw_token, configured_scoped_token):
        actor_label = (x_provisioning_actor or "express_token").strip()[:80] or "express_token"
        return {
            "actor": f"provisioning_token:{actor_label}",
            "role": "provisioning_agent",
            "auth_type": "scoped_token",
        }

    # Fallback explícito: JWT válido de Super Admin (sem bypass)
    admin = get_current_admin(authorization=authorization)
    return {
        "actor": str(admin.get("user") or "superadmin"),
        "role": "superadmin",
        "auth_type": "superadmin_jwt",
    }


def _to_engine_input(
    payload: PublicProvisioningPreviewRequest | PublicProvisioningStartRequest | ExpressProvisioningRequest,
    *,
    allow_qa: bool = False,
) -> UniversalProvisioningInput:
    raw_hours = [
        {"days": row.days, "hours": row.hours}
        for row in (payload.operating_hours or [])
    ]
    raw_items = [item.model_dump() for item in (payload.menu_items or [])]
    operation_profile = payload.operation_profile
    if operation_profile is not None and operation_profile not in SUPPORTED_OPERATION_PROFILES:
        operation_profile = "generic"

    return UniversalProvisioningInput(
        name=payload.name or "",
        subdomain=payload.subdomain,
        explicit_subdomain=bool(payload.subdomain and payload.subdomain.strip()),
        plan=payload.plan or "pro",
        operation_profile=operation_profile,
        segment_preset=payload.segment_preset,
        admin_name=payload.admin_name or "",
        admin_email=payload.admin_email or "",
        admin_password=getattr(payload, "admin_password", None),
        phone=payload.phone,
        address=payload.address,
        order_types=list(payload.order_types or []),
        operating_hours=raw_hours,
        apply_segment_preset=payload.apply_segment_preset,
        menu_text=payload.menu_text,
        menu_items=raw_items,
        structured_text=payload.structured_text,
        requested_restaurant_id=getattr(payload, "restaurant_id", None) if allow_qa else None,
        defer_trial=bool(getattr(payload, "defer_trial", True)),
        qa_lab=bool(getattr(payload, "qa_lab", False)) if allow_qa else False,
        qa_hours=int(getattr(payload, "qa_hours", 24)) if allow_qa else 24,
        audit_action="UNIVERSAL_TENANT_PROVISION",
        audit_reason="Provisionamento pelo motor universal KÔMA",
        commercial_terms_status="not_contracted",
    )


@router.post("/public/preview")
def preview_public_provisioning(
    payload: PublicProvisioningPreviewRequest,
    request: Request,
    response: Response,
):
    """Analisa texto estruturado ou formulário público sem gravar nem inventar dados."""
    _public_preview_limiter.check(request)
    response.headers["Cache-Control"] = "no-store"

    parsed = parse_express_provisioning_input(
        structured_text=payload.structured_text,
        raw_json={
            k: v
            for k, v in payload.model_dump(exclude={"structured_text"}).items()
            if v not in (None, "", [])
        },
        require_admin_credentials=True,
    )
    db: Session = SessionLocal()
    try:
        dry_run = provision_restaurant(
            db,
            _to_engine_input(payload, allow_qa=False),
            origin="public_self_service",
            actor="public_preview",
            allow_id_reuse=False,
            dry_run=True,
        )
        return {
            **dry_run,
            "parsed": parsed,
        }
    finally:
        db.close()


@router.post("/public/start", status_code=status.HTTP_201_CREATED)
def start_public_preparation(
    payload: PublicProvisioningStartRequest,
    request: Request,
    response: Response,
    x_idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    x_koma_idempotency_key: str | None = Header(default=None, alias="X-Idempotency-Key"),
):
    """Cria restaurante autônomo em Modo Preparação sem depender do Super Admin."""
    _public_start_limiter.check(request)
    response.headers["Cache-Control"] = "no-store"

    if not payload.admin_password:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Defina uma senha com pelo menos 8 caracteres para acessar seu painel agora.",
        )

    idempotency_key = (
        x_koma_idempotency_key or x_idempotency_key or payload.idempotency_key or ""
    ).strip() or None
    engine_input = _to_engine_input(payload, allow_qa=False)
    engine_input.defer_trial = True
    engine_input.qa_lab = False
    engine_input.requested_restaurant_id = None
    engine_input.audit_reason = "Cadastro autônomo em modo de preparação pelo próprio cliente"

    db: Session = SessionLocal()
    try:
        result = provision_restaurant(
            db,
            engine_input,
            origin="public_self_service",
            actor=f"public_self_service:{engine_input.admin_email or 'prospect'}",
            allow_id_reuse=False,
            dry_run=False,
            idempotency_key=idempotency_key,
        )
        tenant_id = int(result["id"])
        admin_info = result["admin"]
        access_token = create_access_token(
            subject=admin_info["id"],
            restaurante_id=tenant_id,
            role="admin",
            token_version=1,
        )
        return {
            **result,
            "access_token": access_token,
            "token_type": "bearer",
            "user": {
                "id": admin_info["id"],
                "nome": admin_info["name"],
                "usuario": admin_info["email"],
                "email": admin_info["email"],
                "telefone": payload.phone,
                "role": "admin",
                "cargo": "admin",
                "restaurante_id": tenant_id,
                "status": admin_info["status"],
            },
        }
    finally:
        db.close()


@router.post("/express", status_code=status.HTTP_201_CREATED)
def express_provisioning(
    payload: ExpressProvisioningRequest,
    response: Response,
    principal: dict[str, Any] = Depends(get_express_provisioning_principal),
    x_idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    x_koma_idempotency_key: str | None = Header(default=None, alias="X-Idempotency-Key"),
):
    """Endpoint oficial para provisionamento rápido estruturado (CLI/agente/Super Admin)."""
    response.headers["Cache-Control"] = "no-store"
    idempotency_key = (
        x_koma_idempotency_key or x_idempotency_key or payload.idempotency_key or ""
    ).strip() or None
    engine_input = _to_engine_input(payload, allow_qa=True)
    engine_input.audit_reason = (
        "Provisionamento expresso de laboratório QA"
        if payload.qa_lab
        else "Provisionamento expresso estruturado"
    )

    db: Session = SessionLocal()
    try:
        result = provision_restaurant(
            db,
            engine_input,
            origin="express_api",
            actor=principal["actor"],
            allow_id_reuse=True,
            dry_run=payload.dry_run,
            idempotency_key=idempotency_key,
        )
        if payload.dry_run:
            response.status_code = status.HTTP_200_OK
        return result
    finally:
        db.close()
