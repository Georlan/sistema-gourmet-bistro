from __future__ import annotations

import datetime
import hashlib
import math
import uuid
from typing import Any, Literal

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, insert, select, update
from sqlalchemy.orm import Session

from ..catalog_assistance import (
    MAX_CATALOG_SOURCE_SIZE,
    catalog_assistance_requests,
    detect_catalog_source_type,
    safe_catalog_filename,
    utc_now,
)
from ..database import get_db, require_tenant_id
from ..models import ActivityLog, ConfiguracaoRestaurante, Produto, Restaurante, Usuario
from ..saas_billing_models import SaaSSubscription
from ..security import get_current_user
from ..services.onboarding_readiness import evaluate_operational_readiness
from ..services.onboarding_trial import ensure_trial_started_after_onboarding
from .super_admin_onboarding import DEFAULT_TRIAL_DAYS, restaurant_trials


router = APIRouter(prefix="/api/onboarding", tags=["Onboarding"])


class OperationCapabilitiesRequest(BaseModel):
    order_modes: list[Literal["dine_in", "pickup", "delivery"]] = Field(min_length=1, max_length=3)
    online_menu: bool = False
    service_tax: bool = False

    @field_validator("order_modes")
    @classmethod
    def unique_order_modes(cls, value):
        if len(set(value)) != len(value):
            raise ValueError("Não repita tipos de pedido.")
        return value

    model_config = ConfigDict(extra="forbid")


def _as_utc(value: datetime.datetime | None) -> datetime.datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=datetime.timezone.utc)
    return value.astimezone(datetime.timezone.utc)


def _structured_has_items(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, (list, tuple, set, dict)):
        return len(value) > 0
    return bool(str(value).strip())


def _trial_status_payload(row: dict[str, Any] | None, *, setup_pending: bool = False) -> dict[str, Any]:
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


def _profile_is_configured(restaurant: Restaurante) -> bool:
    if bool(str(restaurant.endereco or "").strip()):
        return True
    socials = restaurant.socials if isinstance(restaurant.socials, dict) else {}
    return bool(str(socials.get("whatsapp") or socials.get("telefone") or "").strip())


def _required_progress(steps: dict[str, bool]) -> dict[str, int]:
    """Progresso da implantação sem transformar passos opcionais em bloqueadores."""
    required_ids = ("profile", "hours", "catalog")
    completed = sum(1 for step_id in required_ids if steps.get(step_id, False))
    total = len(required_ids)
    return {
        "completed": completed,
        "total": total,
        "percent": round((completed / total) * 100),
    }


def _require_onboarding_role(current_user: Usuario) -> None:
    role = str(current_user.cargo or current_user.role or "").strip().lower()
    if role not in {"admin", "gerente"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Somente administradores e gerentes podem configurar o onboarding do restaurante.",
        )


def _catalog_assistance_payload(db: Session, tenant_id: int) -> dict[str, Any] | None:
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
    _require_onboarding_role(current_user)

    tenant_id = require_tenant_id()
    restaurant = db.query(Restaurante).filter(Restaurante.id == tenant_id).one_or_none()
    if restaurant is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Restaurante não encontrado.")

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

    readiness = evaluate_operational_readiness(
        db,
        tenant_id=tenant_id,
        restaurant=restaurant,
        config=config,
    )
    product_count = int(
        db.query(func.count(Produto.id))
        .filter(Produto.restaurante_id == tenant_id)
        .scalar()
        or 0
    )

    checks_by_id = {check["id"]: check for check in readiness["configuration"]["checks"]}
    steps = {
        "profile": bool(checks_by_id.get("profile", {}).get("ok")),
        "hours": bool(checks_by_id.get("hours", {}).get("ok")),
        "catalog": bool(checks_by_id.get("catalog", {}).get("ok")),
        "mercadoPago": bool(readiness["payments"]["mercadoPagoConnected"]),
        "firstOrder": bool(readiness["readiness"]["testOrderComplete"]),
    }
    progress = _required_progress(steps)

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
    trial_row = db.execute(
        select(restaurant_trials).where(restaurant_trials.c.restaurante_id == tenant_id)
    ).mappings().one_or_none()

    return {
        "restaurant": {
            "id": str(tenant_id),
            "name": str(restaurant.nome or "Seu restaurante"),
            "slug": str(restaurant.slug or ""),
            "plan": str(restaurant.plano or ""),
        },
        "trial": _trial_status_payload(dict(trial_row) if trial_row else None, setup_pending=setup_pending),
        "payments": readiness["payments"],
        "counts": {
            "products": product_count,
            "activeProducts": readiness["counts"]["activeProducts"],
            "tables": readiness["counts"]["tables"],
        },
        "catalogAssistance": _catalog_assistance_payload(db, tenant_id),
        "steps": steps,
        "progress": progress,
        "capabilities": readiness["capabilities"],
        "configuration": readiness["configuration"],
        "operation": readiness["operation"],
        "readiness": readiness["readiness"],
    }


@router.put("/capabilities")
def save_operation_capabilities(
    payload: OperationCapabilitiesRequest,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    _require_onboarding_role(current_user)
    tenant_id = require_tenant_id()
    config = (
        db.query(ConfiguracaoRestaurante)
        .filter(ConfiguracaoRestaurante.restaurante_id == tenant_id)
        .with_for_update()
        .one_or_none()
    )
    if config is None:
        raise HTTPException(status_code=409, detail="Configurações do restaurante ainda não foram provisionadas.")

    before = config.operation_capabilities
    modes = list(payload.order_modes)
    next_capabilities = {
        "order_modes": modes,
        "online_menu": payload.online_menu,
        "service_tax": payload.service_tax,
    }
    config.operation_capabilities = next_capabilities
    config.mapa_mesas_ativo = "dine_in" in modes
    config.delivery_ativo = "delivery" in modes
    config.modo_exclusivo_salao = modes == ["dine_in"]
    config.taxa_servico_ativa = payload.service_tax
    db.add(
        ActivityLog(
            restaurante_id=tenant_id,
            garcom_id=current_user.id,
            action="ONBOARDING_CAPABILITIES_UPDATE",
            details=f"before={before!r}; after={next_capabilities!r}",
        )
    )
    db.commit()
    return get_onboarding_status(db=db, current_user=current_user)


@router.post("/start-operation")
def start_operation(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    _require_onboarding_role(current_user)
    tenant_id = require_tenant_id()
    restaurant = db.query(Restaurante).filter(Restaurante.id == tenant_id).one_or_none()
    config = (
        db.query(ConfiguracaoRestaurante)
        .filter(ConfiguracaoRestaurante.restaurante_id == tenant_id)
        .with_for_update()
        .one_or_none()
    )
    if restaurant is None or config is None:
        raise HTTPException(status_code=404, detail="Restaurante ou configurações não encontrados.")

    snapshot = evaluate_operational_readiness(
        db,
        tenant_id=tenant_id,
        restaurant=restaurant,
        config=config,
    )
    if not snapshot["configuration"]["complete"]:
        blockers = [
            check["message"]
            for check in snapshot["configuration"]["checks"]
            if check.get("required") and not check.get("ok") and check.get("message")
        ]
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "onboarding_configuration_incomplete",
                "message": "Conclua a configuração antes de iniciar a operação.",
                "blockers": blockers,
            },
        )

    if config.operation_started_at is None:
        now = datetime.datetime.now(datetime.timezone.utc)
        config.operation_started_at = now
        db.add(
            ActivityLog(
                restaurante_id=tenant_id,
                garcom_id=current_user.id,
                action="ONBOARDING_OPERATION_START",
                details="Operação liberada explicitamente após configuração concluída.",
            )
        )
        # O serviço de trial pode confirmar/reativar o provedor e faz commit da
        # mesma sessão quando há transição. Em planos sem transição de trial,
        # o commit abaixo persiste o marco operacional e sua auditoria.
        ensure_trial_started_after_onboarding(
            db,
            restaurante_id=tenant_id,
            actor=f"usuario:{current_user.id}",
        )
        if db.in_transaction():
            db.commit()

    return get_onboarding_status(db=db, current_user=current_user)

