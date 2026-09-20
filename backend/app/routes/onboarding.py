from __future__ import annotations

import datetime
import hashlib
import json
import math
import uuid
from typing import Any, Literal

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import insert, select, update
from sqlalchemy.orm import Session

from ..catalog_assistance import (
    MAX_CATALOG_SOURCE_SIZE,
    catalog_assistance_requests,
    detect_catalog_source_type,
    safe_catalog_filename,
    utc_now,
)
from ..database import get_db, require_tenant_id
from ..models import ActivityLog, ConfiguracaoRestaurante, Restaurante, Usuario
from ..saas_billing_models import SaaSSubscription
from ..security import get_current_user
from ..services.onboarding_readiness import evaluate_onboarding_readiness
from ..services.onboarding_trial import ensure_trial_started_after_onboarding
from ..services.operational_modes import explicit_order_types, normalize_order_types
from .super_admin_onboarding import DEFAULT_TRIAL_DAYS, restaurant_trials


router = APIRouter(prefix="/api/onboarding", tags=["Onboarding"])


class OnboardingOrderTypesRequest(BaseModel):
    order_types: list[Literal["consumo_local", "retirada", "delivery"]] = Field(
        min_length=1,
        max_length=3,
    )

    @field_validator("order_types")
    @classmethod
    def unique_order_types(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value):
            raise ValueError("Não repita modalidades de pedido.")
        return value

    model_config = ConfigDict(extra="forbid")


def _as_utc(value: datetime.datetime | None) -> datetime.datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=datetime.timezone.utc)
    return value.astimezone(datetime.timezone.utc)


def _trial_status_payload(
    row: dict[str, Any] | None,
    *,
    setup_pending: bool = False,
) -> dict[str, Any]:
    if not row:
        if setup_pending:
            return {
                "status": "setup",
                "startsAt": None,
                "endsAt": None,
                "daysRemaining": DEFAULT_TRIAL_DAYS,
            }
        return {
            "status": "unavailable",
            "startsAt": None,
            "endsAt": None,
            "daysRemaining": None,
        }

    now = datetime.datetime.now(datetime.timezone.utc)
    starts_at = _as_utc(row.get("trial_started_at"))
    ends_at = _as_utc(row.get("trial_ends_at"))
    stored_status = str(row.get("trial_status") or "active").strip().lower()
    effective_status = stored_status
    days_remaining: int | None = None

    if ends_at is not None:
        seconds_remaining = (ends_at - now).total_seconds()
        days_remaining = max(0, math.ceil(seconds_remaining / 86_400))
        if seconds_remaining <= 0 and stored_status == "active":
            effective_status = "expired"

    return {
        "status": effective_status,
        "startsAt": starts_at.isoformat() if starts_at else None,
        "endsAt": ends_at.isoformat() if ends_at else None,
        "daysRemaining": days_remaining,
    }


def _require_onboarding_role(current_user: Usuario) -> None:
    role = str(current_user.cargo or current_user.role or "").strip().lower()
    if role not in {"admin", "gerente"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Somente administradores e gerentes podem configurar o onboarding do restaurante.",
        )


def _require_customer_onboarding_mutation(current_user: Usuario) -> None:
    _require_onboarding_role(current_user)
    if getattr(current_user, "is_support_mode", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="O Modo Suporte pode inspecionar o onboarding, mas não iniciar trial nem alterar decisões do cliente.",
        )


def _catalog_assistance_payload(
    db: Session,
    tenant_id: int,
) -> dict[str, Any] | None:
    row = db.execute(
        select(
            catalog_assistance_requests.c.id,
            catalog_assistance_requests.c.original_filename,
            catalog_assistance_requests.c.content_type,
            catalog_assistance_requests.c.file_size,
            catalog_assistance_requests.c.status,
            catalog_assistance_requests.c.created_at,
            catalog_assistance_requests.c.updated_at,
        )
        .where(catalog_assistance_requests.c.restaurante_id == tenant_id)
        .order_by(catalog_assistance_requests.c.created_at.desc())
        .limit(1)
    ).mappings().first()
    if row is None:
        return None
    return {
        "id": str(row["id"]),
        "filename": str(row["original_filename"]),
        "contentType": str(row["content_type"]),
        "fileSize": int(row["file_size"]),
        "status": str(row["status"]),
        "createdAt": _as_utc(row["created_at"]).isoformat() if row["created_at"] else None,
        "updatedAt": _as_utc(row["updated_at"]).isoformat() if row["updated_at"] else None,
    }


def _build_onboarding_status(
    db: Session,
    *,
    current_user: Usuario,
) -> dict[str, Any]:
    tenant_id = require_tenant_id()
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

    config = (
        db.query(ConfiguracaoRestaurante)
        .filter(ConfiguracaoRestaurante.restaurante_id == tenant_id)
        .one_or_none()
    )
    subscription = (
        db.query(SaaSSubscription)
        .filter(SaaSSubscription.restaurante_id == tenant_id)
        .one_or_none()
    )
    setup_pending = bool(
        subscription
        and subscription.trial_started_at is None
        and str(subscription.status or "").strip().lower() in {"onboarding", "suspended"}
    )
    trial_started_at = (
        _as_utc(subscription.trial_started_at)
        if subscription and subscription.trial_started_at
        else None
    )

    readiness = evaluate_onboarding_readiness(
        db,
        tenant_id=tenant_id,
        restaurant=restaurant,
        config=config,
        setup_pending=setup_pending,
        trial_started_at=trial_started_at,
    )

    trial_row = db.execute(
        select(restaurant_trials).where(
            restaurant_trials.c.restaurante_id == tenant_id
        )
    ).mappings().one_or_none()

    return {
        "restaurant": {
            "id": str(tenant_id),
            "name": str(restaurant.nome or "Seu restaurante"),
            "slug": str(restaurant.slug or ""),
            "plan": str(restaurant.plano or ""),
        },
        "trial": _trial_status_payload(
            dict(trial_row) if trial_row else None,
            setup_pending=setup_pending,
        ),
        "setupPending": setup_pending,
        "trialCanStart": bool(
            setup_pending
            and readiness["readiness"]["configurationComplete"]
            and not getattr(current_user, "is_support_mode", False)
        ),
        **readiness,
        "catalogAssistance": _catalog_assistance_payload(db, tenant_id),
    }


@router.post("/catalog-assistance", status_code=status.HTTP_201_CREATED)
async def submit_catalog_assistance(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Recebe PDF/foto do cardápio para implantação assistida pela equipe KÔMA."""
    _require_onboarding_role(current_user)
    tenant_id = require_tenant_id()
    restaurant = (
        db.query(Restaurante)
        .filter(Restaurante.id == tenant_id)
        .one_or_none()
    )
    if restaurant is None:
        raise HTTPException(status_code=404, detail="Restaurante não encontrado.")

    content = await file.read(MAX_CATALOG_SOURCE_SIZE + 1)
    if not content:
        raise HTTPException(status_code=422, detail="O arquivo do cardápio está vazio.")
    if len(content) > MAX_CATALOG_SOURCE_SIZE:
        raise HTTPException(
            status_code=413,
            detail="O arquivo deve ter no máximo 10 MB.",
        )
    try:
        content_type = detect_catalog_source_type(file.content_type, content)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    now = utc_now()
    request_id = str(uuid.uuid4())
    filename = safe_catalog_filename(file.filename, content_type)
    digest = hashlib.sha256(content).hexdigest()

    db.execute(
        update(catalog_assistance_requests)
        .where(
            catalog_assistance_requests.c.restaurante_id == tenant_id,
            catalog_assistance_requests.c.status.in_(("pending", "processing")),
        )
        .values(status="superseded", updated_at=now)
    )
    db.execute(
        insert(catalog_assistance_requests).values(
            id=request_id,
            restaurante_id=tenant_id,
            original_filename=filename,
            content_type=content_type,
            file_size=len(content),
            file_sha256=digest,
            file_content=content,
            status="pending",
            created_at=now,
            updated_at=now,
        )
    )
    db.commit()

    return {
        "id": request_id,
        "filename": filename,
        "contentType": content_type,
        "fileSize": len(content),
        "status": "pending",
        "message": "Cardápio recebido. A equipe KÔMA vai preparar a estrutura para revisão e publicação.",
    }


@router.get("/status")
def get_onboarding_status(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Projeta o onboarding sem iniciar trial nem alterar configuração."""
    _require_onboarding_role(current_user)
    return _build_onboarding_status(db, current_user=current_user)


@router.put("/order-types")
def update_onboarding_order_types(
    payload: OnboardingOrderTypesRequest,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Persiste somente a política canônica de modalidades escolhida pelo cliente."""
    _require_customer_onboarding_mutation(current_user)
    tenant_id = require_tenant_id()
    config = (
        db.query(ConfiguracaoRestaurante)
        .filter(ConfiguracaoRestaurante.restaurante_id == tenant_id)
        .one_or_none()
    )
    if config is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Configurações do restaurante ainda não foram provisionadas.",
        )

    before = explicit_order_types(config)
    normalized = normalize_order_types(payload.order_types)
    if not normalized:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Escolha ao menos uma modalidade de pedido.",
        )

    if before != normalized:
        config.tipos_pedido_ativos = normalized
        db.add(
            ActivityLog(
                restaurante_id=tenant_id,
                garcom_id=current_user.id,
                action="ONBOARDING_ORDER_TYPES_UPDATE",
                details=json.dumps(
                    {
                        "before": before,
                        "after": normalized,
                    },
                    ensure_ascii=False,
                    sort_keys=True,
                ),
            )
        )
        db.commit()

    return _build_onboarding_status(db, current_user=current_user)


@router.post("/start-trial")
def start_trial_after_readiness(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Inicia trial e libera a operação somente após ação explícita do cliente."""
    _require_customer_onboarding_mutation(current_user)
    snapshot = _build_onboarding_status(db, current_user=current_user)
    if not snapshot["readiness"]["configurationComplete"]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Conclua a configuração mínima do restaurante antes de iniciar o período grátis.",
        )

    if snapshot["trial"]["status"] == "setup":
        result = ensure_trial_started_after_onboarding(
            db,
            restaurante_id=require_tenant_id(),
            actor=f"usuario:{current_user.id}",
        )
        if result is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="O período grátis não está disponível para esta assinatura.",
            )

    return _build_onboarding_status(db, current_user=current_user)
