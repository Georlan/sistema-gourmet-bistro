"""Resolvedor canônico de recursos comerciais por restaurante.

O plano fornece o baseline do catálogo atual. Uma RestauranteCapability explícita
sempre prevalece, permitindo add-on, trial, promoção, liberação manual ou revogação
sem espalhar comparações Pocket/Pro/Premium pelas rotas.
"""

from __future__ import annotations

from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from ..models import Restaurante
from ..smartpos_models import RestauranteCapability
from ..subscription import get_effective_subscription_plan


ENTITLEMENT_PRINTING = "printing"
ENTITLEMENT_KDS = "kds"
ENTITLEMENT_WAITER_APP = "waiter_app"
ENTITLEMENT_LOYALTY = "loyalty"
ENTITLEMENT_COUPONS = "coupons"

KNOWN_ENTITLEMENTS = frozenset(
    {
        ENTITLEMENT_PRINTING,
        ENTITLEMENT_KDS,
        ENTITLEMENT_WAITER_APP,
        ENTITLEMENT_LOYALTY,
        ENTITLEMENT_COUPONS,
    }
)

_PLAN_ENTITLEMENTS: dict[str, frozenset[str]] = {
    "pocket": frozenset(),
    "pro": frozenset(
        {
            ENTITLEMENT_PRINTING,
            ENTITLEMENT_KDS,
            ENTITLEMENT_WAITER_APP,
        }
    ),
    "premium": KNOWN_ENTITLEMENTS,
}


def _normalize_entitlement(entitlement: str) -> str:
    normalized = (entitlement or "").strip().lower()
    if normalized not in KNOWN_ENTITLEMENTS:
        raise ValueError(f"Entitlement desconhecido: {entitlement!r}")
    return normalized


def _stored_plan(
    db: Session,
    restaurante_id: int,
    stored_plan: Optional[str],
) -> Optional[str]:
    if stored_plan is not None:
        return stored_plan
    restaurante = (
        db.query(Restaurante)
        .filter(Restaurante.id == restaurante_id)
        .first()
    )
    return restaurante.plano if restaurante is not None else None


def has_plan_entitlement(
    db: Session,
    restaurante_id: int,
    entitlement: str,
    *,
    stored_plan: Optional[str] = None,
) -> bool:
    """Resolve plano + override explícito de capability.

    A linha explícita vence o baseline, inclusive quando enabled=False.
    Isso permite revogar um recurso de um plano ou concedê-lo como add-on sem
    alterar o slug comercial do restaurante.
    """

    normalized = _normalize_entitlement(entitlement)
    explicit = (
        db.query(RestauranteCapability)
        .filter(
            RestauranteCapability.restaurante_id == restaurante_id,
            RestauranteCapability.capability == normalized,
        )
        .first()
    )
    if explicit is not None:
        return bool(explicit.enabled)

    effective_plan = get_effective_subscription_plan(
        restaurante_id,
        _stored_plan(db, restaurante_id, stored_plan),
    )
    return normalized in _PLAN_ENTITLEMENTS[effective_plan]


def resolve_plan_entitlements(
    db: Session,
    restaurante_id: int,
    *,
    stored_plan: Optional[str] = None,
) -> dict[str, bool]:
    return {
        entitlement: has_plan_entitlement(
            db,
            restaurante_id,
            entitlement,
            stored_plan=stored_plan,
        )
        for entitlement in sorted(KNOWN_ENTITLEMENTS)
    }


def require_plan_entitlement(
    db: Session,
    restaurante_id: int,
    entitlement: str,
    *,
    stored_plan: Optional[str] = None,
    detail: str = "Recurso não disponível no plano atual.",
) -> None:
    if not has_plan_entitlement(
        db,
        restaurante_id,
        entitlement,
        stored_plan=stored_plan,
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=detail,
        )
