from __future__ import annotations

import datetime
import math
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..database import get_db, require_tenant_id
from ..models import Comanda, Produto, RestaurantPaymentAccount, Restaurante, Usuario
from ..security import get_current_user
from .super_admin_onboarding import restaurant_trials


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


def _trial_status_payload(row: dict[str, Any] | None) -> dict[str, Any]:
    if not row:
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


@router.get("/status")
def get_onboarding_status(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    role = str(current_user.cargo or current_user.role or "").strip().lower()
    if role not in {"admin", "gerente"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Somente administradores e gerentes podem consultar o onboarding do restaurante.",
        )

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

    trial_row = db.execute(
        select(restaurant_trials).where(restaurant_trials.c.restaurante_id == tenant_id)
    ).mappings().one_or_none()

    product_count = int(
        db.query(func.count(Produto.id))
        .filter(Produto.restaurante_id == tenant_id)
        .scalar()
        or 0
    )
    order_count = int(
        db.query(func.count(Comanda.id))
        .filter(Comanda.restaurante_id == tenant_id)
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

    profile_configured = _profile_is_configured(restaurant)
    hours_configured = _structured_has_items(restaurant.horarios_funcionamento)
    catalog_configured = product_count > 0
    first_order_detected = order_count > 0

    steps = {
        "profile": profile_configured,
        "hours": hours_configured,
        "catalog": catalog_configured,
        "mercadoPago": mercado_pago_connected,
        "firstOrder": first_order_detected,
    }
    completed = sum(1 for done in steps.values() if done)

    return {
        "restaurant": {
            "id": str(tenant_id),
            "name": str(restaurant.nome or "Seu restaurante"),
            "slug": str(restaurant.slug or ""),
            "plan": str(restaurant.plano or ""),
        },
        "trial": _trial_status_payload(dict(trial_row) if trial_row else None),
        "payments": {
            "mercadoPagoConnected": mercado_pago_connected,
        },
        "counts": {
            "products": product_count,
            "orders": order_count,
        },
        "steps": steps,
        "progress": {
            "completed": completed,
            "total": len(steps),
            "percent": round((completed / len(steps)) * 100),
        },
    }
