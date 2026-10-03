"""Resolvedor canônico de recursos comerciais por restaurante.

O plano fornece o baseline do catálogo atual. Uma RestauranteCapability explícita
sempre prevalece, permitindo add-on, trial, promoção, liberação manual ou revogação
sem espalhar comparações Pocket/Pro/Premium pelas rotas.
"""

from __future__ import annotations

from typing import Iterable, Optional

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
ENTITLEMENT_COURIER_APP = "courier_app"
ENTITLEMENT_INVENTORY = "inventory"
ENTITLEMENT_ADVANCED_REPORTS = "advanced_reports"

KNOWN_ENTITLEMENTS = frozenset(
    {
        ENTITLEMENT_PRINTING,
        ENTITLEMENT_KDS,
        ENTITLEMENT_WAITER_APP,
        ENTITLEMENT_LOYALTY,
        ENTITLEMENT_COUPONS,
        ENTITLEMENT_COURIER_APP,
        ENTITLEMENT_INVENTORY,
        ENTITLEMENT_ADVANCED_REPORTS,
    }
)

_PLAN_ENTITLEMENTS: dict[str, frozenset[str]] = {
    "pocket": frozenset({ENTITLEMENT_WAITER_APP}),
    "pro": frozenset(
        {
            ENTITLEMENT_PRINTING,
            ENTITLEMENT_KDS,
            ENTITLEMENT_WAITER_APP,
            ENTITLEMENT_INVENTORY,
            ENTITLEMENT_ADVANCED_REPORTS,
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
        db.query(Restaurante.plano)
        .filter(Restaurante.id == restaurante_id)
        .first()
    )
    return restaurante[0] if restaurante is not None else None


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
    return resolve_plan_entitlements(
        db, restaurante_id, stored_plan=stored_plan, entitlements=(normalized,),
    )[normalized]


def plan_entitlement_baseline(restaurante_id: int, stored_plan: Optional[str]) -> dict[str, bool]:
    """Baseline comercial sem aplicar overrides individuais."""
    plan = get_effective_subscription_plan(restaurante_id, stored_plan)
    return {key: key in _PLAN_ENTITLEMENTS[plan] for key in sorted(KNOWN_ENTITLEMENTS)}


def resolve_plan_entitlements(
    db: Session,
    restaurante_id: int,
    *,
    stored_plan: Optional[str] = None,
    entitlements: Iterable[str] | None = None,
) -> dict[str, bool]:
    """Read overrides once; use the baseline only for capabilities without overrides.

    This is request-local resolution, never a cache of permissions or revocations.
    """
    from ..database import _effective_tenant_id, tenant_session_scope

    selected = sorted({
        _normalize_entitlement(key)
        for key in (KNOWN_ENTITLEMENTS if entitlements is None else entitlements)
    })
    if not selected:
        return {}

    def _resolve():
        overrides = dict(db.query(RestauranteCapability.capability, RestauranteCapability.enabled).filter(
            RestauranteCapability.restaurante_id == restaurante_id,
            RestauranteCapability.capability.in_(selected),
        ).all())
        baseline = frozenset()
        if any(key not in overrides for key in selected):
            plan = get_effective_subscription_plan(
                restaurante_id, _stored_plan(db, restaurante_id, stored_plan),
            )
            baseline = _PLAN_ENTITLEMENTS[plan]
        return {key: bool(overrides[key]) if key in overrides else key in baseline for key in selected}

    if _effective_tenant_id(db) == int(restaurante_id):
        return _resolve()
    with tenant_session_scope(db, int(restaurante_id)):
        return _resolve()


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
