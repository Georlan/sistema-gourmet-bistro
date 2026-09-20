from __future__ import annotations

import datetime
import hashlib
import json
import math
import uuid
from typing import Any, Literal

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel, Field
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
from ..models import (
    ActivityLog,
    Comanda,
    ConfiguracaoRestaurante,
    Mesa,
    Pagamento,
    Produto,
    RestaurantPaymentAccount,
    Restaurante,
    Usuario,
)
from ..saas_billing_models import SaaSSubscription
from ..security import get_current_user
from ..services.onboarding_readiness import evaluate_operation_readiness
from ..services.onboarding_trial import ensure_trial_started_after_onboarding
from ..services.operational_modes import canonical_order_type_from_comanda, explicit_order_types
from .super_admin_onboarding import DEFAULT_TRIAL_DAYS, restaurant_trials


router = APIRouter(prefix="/api/onboarding", tags=["Onboarding"])

class OnboardingOperationsRequest(BaseModel):
    order_types: list[Literal["consumo_local", "retirada", "delivery"]] = Field(min_length=1)

    model_config = {"extra": "forbid"}



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
    return any(
        bool(str(value).strip())
        for value in (
            restaurant.endereco,
            restaurant.subtitulo,
            restaurant.sobre_nos,
            restaurant.logo_url,
            restaurant.banner_url,
        )
        if value is not None
    )


def _required_progress(steps: dict[str, bool]) -> dict[str, int]:
    """Progresso da implantação sem transformar passos opcionais em bloqueadores."""
    required_ids = ("profile", "hours", "catalog", "operations")
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


def _test_order_type_values(order_types: list[str]) -> list[str]:
    values: list[str] = []
    if "consumo_local" in order_types:
        values.append("Consumo no Local")
    if "retirada" in order_types:
        values.append("Retirada")
    if "delivery" in order_types:
        values.extend(["Delivery", "Entrega"])
    return values


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
    subscription_status = str(getattr(subscription, "status", "") or "").strip().lower()
    setup_pending = bool(
        subscription
        and subscription.trial_started_at is None
        and subscription_status in {"onboarding", "suspended"}
    )
    legacy_policy_allowed = bool(
        subscription
        and (
            subscription.trial_started_at is not None
            or subscription_status not in {"onboarding", "suspended"}
        )
    )

    product_count = int(
        db.query(func.count(Produto.id))
        .filter(Produto.restaurante_id == tenant_id)
        .scalar()
        or 0
    )
    active_product_count = int(
        db.query(func.count(Produto.id))
        .filter(
            Produto.restaurante_id == tenant_id,
            Produto.ativo.is_(True),
        )
        .scalar()
        or 0
    )
    order_count = int(
        db.query(func.count(Comanda.id))
        .filter(Comanda.restaurante_id == tenant_id)
        .scalar()
        or 0
    )
    table_count = int(
        db.query(func.count(Mesa.pk))
        .filter(Mesa.restaurante_id == tenant_id)
        .scalar()
        or 0
    )

    payment_account = (
        db.query(RestaurantPaymentAccount)
        .filter(
            RestaurantPaymentAccount.restaurante_id == tenant_id,
            RestaurantPaymentAccount.provider == "mercado_pago",
            RestaurantPaymentAccount.status == "active",
        )
        .first()
    )
    mercado_pago_connected = bool(
        payment_account
        and payment_account.access_token
        and payment_account.webhook_secret
    )

    operations = evaluate_operation_readiness(
        config=config,
        restaurant=restaurant,
        table_count=table_count,
        legacy_policy_allowed=legacy_policy_allowed,
    )

    explicit_modes = explicit_order_types(config)
    test_order_detected = False
    if subscription and subscription.trial_started_at is not None:
        query = (
            db.query(Comanda)
            .join(
                Pagamento,
                (Pagamento.comanda_id == Comanda.id)
                & (Pagamento.restaurante_id == Comanda.restaurante_id),
            )
            .filter(
                Comanda.restaurante_id == tenant_id,
                Comanda.onboarding_test.is_(True),
                Comanda.fechada.is_(True),
                Comanda.criado_em >= subscription.trial_started_at,
                Pagamento.restaurante_id == tenant_id,
                Pagamento.status == "aprovado",
            )
        )
        if explicit_modes:
            query = query.filter(Comanda.tipo.in_(_test_order_type_values(explicit_modes)))
        test_order_detected = query.first() is not None

    steps = {
        "profile": _profile_is_configured(restaurant),
        "hours": _structured_has_items(restaurant.horarios_funcionamento),
        "catalog": active_product_count > 0,
        "operations": bool(operations["ready"]),
        "mercadoPago": mercado_pago_connected,
        "firstOrder": test_order_detected,
    }
    progress = _required_progress(steps)
    configuration_complete = (
        progress["total"] > 0
        and progress["completed"] >= progress["total"]
    )
    trial_started = bool(subscription and subscription.trial_started_at is not None)
    ready_to_operate = configuration_complete and trial_started and test_order_detected

    blockers = [
        key
        for key in ("profile", "hours", "catalog", "operations")
        if not steps[key]
    ]
    if configuration_complete and not trial_started:
        blockers.append("trial")
    elif configuration_complete and not test_order_detected:
        blockers.append("test_order")

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
        "trial": _trial_status_payload(
            dict(trial_row) if trial_row else None,
            setup_pending=setup_pending,
        ),
        "trialCanStart": bool(
            setup_pending
            and configuration_complete
            and not getattr(current_user, "is_support_mode", False)
        ),
        "payments": {
            "mercadoPagoConnected": mercado_pago_connected,
            "pixOnlineAvailable": mercado_pago_connected,
        },
        "counts": {
            "products": product_count,
            "activeProducts": active_product_count,
            "orders": order_count,
            "tables": table_count,
        },
        "operations": operations,
        "catalogAssistance": _catalog_assistance_payload(db, tenant_id),
        "steps": steps,
        "progress": progress,
        "readiness": {
            "configurationComplete": configuration_complete,
            "trialStarted": trial_started,
            "readyToOperate": ready_to_operate,
            "blockers": blockers,
        },
    }


@router.get("/status")
def get_onboarding_status(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Read-only projection. Never starts trial or mutates onboarding state."""
    _require_onboarding_role(current_user)
    return _build_onboarding_status(db, current_user=current_user)


@router.put("/operations")
def update_onboarding_operations(
    payload: OnboardingOperationsRequest,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Persist only the canonical fulfillment policy; specialized settings stay separate."""
    _require_onboarding_role(current_user)
    tenant_id = require_tenant_id()
    config = (
        db.query(ConfiguracaoRestaurante)
        .filter(ConfiguracaoRestaurante.restaurante_id == tenant_id)
        .one_or_none()
    )
    if config is None:
        raise HTTPException(status_code=409, detail="Configurações do restaurante não encontradas.")

    before = explicit_order_types(config)
    after = list(dict.fromkeys(payload.order_types))
    config.tipos_pedido_ativos = after
    db.add(
        ActivityLog(
            restaurante_id=tenant_id,
            garcom_id=current_user.id,
            action="ONBOARDING_OPERATION_MODES_UPDATE",
            details=json.dumps(
                {"before": before, "after": after},
                ensure_ascii=False,
                separators=(",", ":"),
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
    """Explicitly releases operation and starts the trial after minimum setup."""
    _require_onboarding_role(current_user)
    if getattr(current_user, "is_support_mode", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Modo Suporte não pode iniciar o período grátis do cliente.",
        )

    snapshot = _build_onboarding_status(db, current_user=current_user)
    if not snapshot["readiness"]["configurationComplete"]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Conclua a configuração mínima antes de iniciar o período grátis.",
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
        db.add(
            ActivityLog(
                restaurante_id=require_tenant_id(),
                garcom_id=current_user.id,
                action="ONBOARDING_TRIAL_STARTED",
                details="Início explícito do período grátis e liberação operacional.",
            )
        )
        db.commit()

    return _build_onboarding_status(db, current_user=current_user)
