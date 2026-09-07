from __future__ import annotations

import datetime
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from ..config import settings
from ..saas_billing_models import SaaSBillingSetup, SaaSSubscription
from ..models import Restaurante


@dataclass(frozen=True)
class TenantEntitlement:
    allowed: bool
    reason: str
    billing_status: str
    grace_until: datetime.datetime | None = None


def is_billing_enforcement_enabled() -> bool:
    """Retorna se o gate obrigatório de billing está ativado na plataforma."""
    return bool(settings.KOMA_SAAS_BILLING_ENFORCEMENT_ENABLED)


def get_billing_setup(db: Session, protocol: str) -> SaaSBillingSetup | None:
    """Busca o setup de cobrança associado a um protocolo de contratação."""
    normalized = protocol.strip().upper()
    return (
        db.query(SaaSBillingSetup)
        .filter(SaaSBillingSetup.protocol == normalized)
        .one_or_none()
    )


def is_billing_ready(db: Session, protocol: str) -> bool:
    """
    Verifica se a contratação possui método de pagamento configurado e pronto.
    Para cartão: tokenização e validação confirmada no gateway.
    Para Pix anual: pagamento confirmado via webhook do gateway.
    """
    setup = get_billing_setup(db, protocol)
    if setup is None:
        return False
    return str(setup.status).strip().lower() == "ready"


def resolve_tenant_entitlement(db: Session, restaurante_id: int) -> TenantEntitlement:
    """
    Fonte canônica de autoridade sobre o acesso do tenant às operações (Caixa/Salão).
    Avalia a assinatura formal; caso não exista, mantém fallback seguro
    para compatibilidade com os tenants legados das fases anteriores.
    """
    now = datetime.datetime.now(datetime.timezone.utc)

    # 1. Verifica se há assinatura canônica em saas_subscriptions
    sub = (
        db.query(SaaSSubscription)
        .filter(SaaSSubscription.restaurante_id == restaurante_id)
        .one_or_none()
    )
    if sub is not None:
        sub_status = str(sub.status or "").strip().lower()
        if sub_status == "active":
            return TenantEntitlement(allowed=True, reason="subscription_active", billing_status="active")

        if sub_status == "trialing":
            ends_at = sub.trial_ends_at
            if ends_at is not None and ends_at.tzinfo is None:
                ends_at = ends_at.replace(tzinfo=datetime.timezone.utc)
            if ends_at is None or now <= ends_at:
                return TenantEntitlement(allowed=True, reason="trial_active", billing_status="trialing")
            return TenantEntitlement(allowed=False, reason="trial_expired", billing_status="past_due")

        if sub_status == "past_due":
            grace = sub.grace_until
            if grace is not None and grace.tzinfo is None:
                grace = grace.replace(tzinfo=datetime.timezone.utc)
            if grace is not None and now <= grace:
                return TenantEntitlement(
                    allowed=True,
                    reason="past_due_in_grace",
                    billing_status="past_due",
                    grace_until=grace,
                )
            return TenantEntitlement(
                allowed=False,
                reason="past_due_grace_expired",
                billing_status="past_due",
            )

        if sub_status == "suspended":
            return TenantEntitlement(allowed=False, reason="tenant_suspended", billing_status="suspended")

        if sub_status == "canceled":
            period_end = sub.current_period_end
            if period_end is not None and period_end.tzinfo is None:
                period_end = period_end.replace(tzinfo=datetime.timezone.utc)
            if period_end is not None and now <= period_end:
                return TenantEntitlement(allowed=True, reason="canceled_active_until_end", billing_status="canceled")
            return TenantEntitlement(allowed=False, reason="canceled_expired", billing_status="canceled")

    # 2. Fallback de compatibilidade com modelos legados (Restaurante.saas_status)
    restaurante = db.query(Restaurante).filter(Restaurante.id == restaurante_id).one_or_none()
    if restaurante is not None and getattr(restaurante, "saas_status", "active") == "suspended":
        return TenantEntitlement(allowed=False, reason="tenant_suspended", billing_status="suspended")

    return TenantEntitlement(allowed=True, reason="legacy_active", billing_status="active")
