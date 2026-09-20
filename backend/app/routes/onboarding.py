from __future__ import annotations

import datetime
import hashlib
import math
import uuid
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
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
from ..services.onboarding_trial import ensure_trial_started_after_onboarding
from .super_admin_onboarding import DEFAULT_TRIAL_DAYS, restaurant_trials


router = APIRouter(prefix="/api/onboarding", tags=["Onboarding"])


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


def _normalize_order_types(config: ConfiguracaoRestaurante | None) -> list[str]:
    raw = getattr(config, "tipos_pedido_ativos", None) if config is not None else None
    if not isinstance(raw, list):
        return []
    allowed = {"consumo_local", "retirada", "delivery"}
    return list(dict.fromkeys(str(value) for value in raw if str(value) in allowed))


def _delivery_is_configured(
    config: ConfiguracaoRestaurante | None,
    restaurant: Restaurante,
) -> bool:
    if config is None or config.delivery_ativo is not True:
        return False
    mode = str(config.tipo_taxa_entrega or "fixa").strip().lower()
    if mode == "fixa":
        try:
            return config.taxa_entrega_fixa is not None and float(config.taxa_entrega_fixa) >= 0
        except (TypeError, ValueError):
            return False
    if mode == "bairro":
        return _structured_has_items(config.tabela_taxas_bairros)
    if mode == "distancia":
        return (
            _structured_has_items(config.tabela_taxas_km)
            and restaurant.latitude is not None
            and restaurant.longitude is not None
        )
    return False


def _operation_readiness(
    *,
    config: ConfiguracaoRestaurante | None,
    restaurant: Restaurante,
    table_count: int,
    mercado_pago_connected: bool,
) -> dict[str, Any]:
    order_types = _normalize_order_types(config)
    configured = bool(order_types)

    dine_in_enabled = "consumo_local" in order_types
    pickup_enabled = "retirada" in order_types
    delivery_enabled = "delivery" in order_types

    table_map_enabled = bool(config and config.mapa_mesas_ativo)
    dine_in_ready = (
        not dine_in_enabled
        or not table_map_enabled
        or table_count > 0
    )
    pickup_ready = not pickup_enabled or configured
    delivery_ready = (
        not delivery_enabled
        or _delivery_is_configured(config, restaurant)
    )

    service_charge_enabled = bool(config and config.taxa_servico_ativa)
    try:
        service_charge_percent = float(config.taxa_servico_padrao or 0) if config else 0.0
    except (TypeError, ValueError):
        service_charge_percent = 0.0
    service_charge_ready = (
        not service_charge_enabled
        or 0 < service_charge_percent <= 100
    )

    online_payment_enabled = bool(getattr(restaurant, "pagamento_online_ativo", False))
    online_payment_ready = not online_payment_enabled or mercado_pago_connected

    blockers: list[str] = []
    if not configured:
        blockers.append("order_types")
    if dine_in_enabled and not dine_in_ready:
        blockers.append("dine_in_tables")
    if delivery_enabled and not delivery_ready:
        blockers.append("delivery_configuration")
    if service_charge_enabled and not service_charge_ready:
        blockers.append("service_charge")
    if online_payment_enabled and not online_payment_ready:
        blockers.append("mercado_pago")

    return {
        "configured": configured,
        "ready": configured and not blockers,
        "orderTypes": order_types,
        "tableMapEnabled": table_map_enabled,
        "serviceChargeEnabled": service_charge_enabled,
        "serviceChargePercent": service_charge_percent,
        "capabilities": {
            "dineIn": {"enabled": dine_in_enabled, "ready": dine_in_ready},
            "pickup": {"enabled": pickup_enabled, "ready": pickup_ready},
            "delivery": {"enabled": delivery_enabled, "ready": delivery_ready},
            "serviceCharge": {
                "enabled": service_charge_enabled,
                "ready": service_charge_ready,
            },
            "onlinePayment": {
                "enabled": online_payment_enabled,
                "ready": online_payment_ready,
            },
        },
        "blockers": blockers,
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
    completed_paid_order_count = int(
        db.query(func.count(func.distinct(Comanda.id)))
        .join(
            Pagamento,
            (Pagamento.comanda_id == Comanda.id)
            & (Pagamento.restaurante_id == Comanda.restaurante_id),
        )
        .filter(
            Comanda.restaurante_id == tenant_id,
            Comanda.fechada.is_(True),
            Pagamento.restaurante_id == tenant_id,
            Pagamento.status == "aprovado",
        )
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

    operations = _operation_readiness(
        config=config,
        restaurant=restaurant,
        table_count=table_count,
        mercado_pago_connected=mercado_pago_connected,
    )

    steps = {
        "profile": _profile_is_configured(restaurant),
        "hours": _structured_has_items(restaurant.horarios_funcionamento),
        "catalog": active_product_count > 0,
        "operations": bool(operations["ready"]),
        "mercadoPago": mercado_pago_connected,
        "firstOrder": completed_paid_order_count > 0,
    }
    progress = _required_progress(steps)
    configuration_complete = (
        progress["total"] > 0
        and progress["completed"] >= progress["total"]
    )
    ready_to_operate = configuration_complete and steps["firstOrder"]

    readiness_blockers = [
        step_id
        for step_id in ("profile", "hours", "catalog", "operations")
        if not steps[step_id]
    ]
    if configuration_complete and not steps["firstOrder"]:
        readiness_blockers.append("first_order")

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
        "trial": _trial_status_payload(
            dict(trial_row) if trial_row else None,
            setup_pending=setup_pending,
        ),
        "trialCanStart": bool(setup_pending and ready_to_operate),
        "payments": {
            "mercadoPagoConnected": mercado_pago_connected,
        },
        "counts": {
            "products": product_count,
            "activeProducts": active_product_count,
            "orders": order_count,
            "completedPaidOrders": completed_paid_order_count,
            "tables": table_count,
        },
        "operations": operations,
        "catalogAssistance": _catalog_assistance_payload(db, tenant_id),
        "steps": steps,
        "progress": progress,
        "readiness": {
            "configurationComplete": configuration_complete,
            "readyToOperate": ready_to_operate,
            "state": "ready" if ready_to_operate else "configuration",
            "blockers": readiness_blockers,
        },
    }


@router.get("/status")
def get_onboarding_status(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    _require_onboarding_role(current_user)
    return _build_onboarding_status(db, current_user=current_user)


@router.post("/start-trial")
def start_trial_after_readiness(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Inicia o período grátis apenas após ação explícita do responsável."""
    _require_onboarding_role(current_user)
    snapshot = _build_onboarding_status(db, current_user=current_user)
    if not snapshot["readiness"]["readyToOperate"]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Conclua a configuração e finalize um pedido de teste com pagamento "
                "antes de iniciar o período grátis."
            ),
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
