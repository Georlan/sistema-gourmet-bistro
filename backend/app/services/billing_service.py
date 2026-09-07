from __future__ import annotations

import datetime
from dataclasses import dataclass
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from ..config import settings
from ..models import Restaurante
from ..saas_billing_models import SaaSBillingSetup, SaaSSubscription


@dataclass(frozen=True)
class TenantEntitlement:
    allowed: bool
    reason: str
    billing_status: str
    grace_until: datetime.datetime | None = None


@dataclass(frozen=True)
class BillingSetupData:
    id: str
    protocol: str
    contract_acceptance_id: str | None
    restaurante_id: int | None
    provider: str
    payment_method_type: str
    status: str
    provider_customer_id: str | None
    provider_payment_method_reference: str | None
    provider_subscription_id: str | None
    billing_cycle: str | None
    created_at: Any = None
    updated_at: Any = None


def is_billing_enforcement_enabled() -> bool:
    """Retorna se o gate obrigatório de billing está ativado na plataforma."""
    return bool(settings.KOMA_SAAS_BILLING_ENFORCEMENT_ENABLED)


def get_billing_setup(db: Session, protocol: str) -> BillingSetupData | None:
    """Busca o setup de cobrança associado a um protocolo de contratação."""
    normalized = protocol.strip().upper()

    if db.get_bind().dialect.name == "postgresql":
        row = db.execute(
            text("SELECT * FROM koma_internal.get_saas_billing_setup(:protocol)"),
            {"protocol": normalized},
        ).mappings().one_or_none()
        if not row:
            return None
        return BillingSetupData(**dict(row))

    setup = (
        db.query(SaaSBillingSetup)
        .filter(SaaSBillingSetup.protocol == normalized)
        .one_or_none()
    )
    if setup is None:
        return None
    return BillingSetupData(
        id=str(setup.id),
        protocol=str(setup.protocol),
        contract_acceptance_id=str(setup.contract_acceptance_id) if setup.contract_acceptance_id else None,
        restaurante_id=int(setup.restaurante_id) if setup.restaurante_id is not None else None,
        provider=str(setup.provider),
        payment_method_type=str(setup.payment_method_type),
        status=str(setup.status),
        provider_customer_id=str(setup.provider_customer_id) if setup.provider_customer_id else None,
        provider_payment_method_reference=str(setup.provider_payment_method_reference) if setup.provider_payment_method_reference else None,
        provider_subscription_id=str(setup.provider_subscription_id) if setup.provider_subscription_id else None,
        billing_cycle=str(setup.billing_cycle) if setup.billing_cycle else None,
        created_at=setup.created_at,
        updated_at=setup.updated_at,
    )


def get_billing_setup_by_provider_sub(db: Session, provider: str, sub_id: str) -> BillingSetupData | None:
    """Busca o setup de cobrança pelo ID de assinatura retornado pelo provedor."""
    if db.get_bind().dialect.name == "postgresql":
        row = db.execute(
            text(
                "SELECT * FROM koma_internal.get_saas_billing_setup_by_provider_sub(:provider, :sub_id)"
            ),
            {"provider": provider, "sub_id": sub_id},
        ).mappings().one_or_none()
        if not row:
            return None
        return BillingSetupData(**dict(row))

    setup = (
        db.query(SaaSBillingSetup)
        .filter(
            SaaSBillingSetup.provider == provider,
            SaaSBillingSetup.provider_subscription_id == sub_id,
        )
        .one_or_none()
    )
    if setup is None:
        return None
    return BillingSetupData(
        id=str(setup.id),
        protocol=str(setup.protocol),
        contract_acceptance_id=str(setup.contract_acceptance_id) if setup.contract_acceptance_id else None,
        restaurante_id=int(setup.restaurante_id) if setup.restaurante_id is not None else None,
        provider=str(setup.provider),
        payment_method_type=str(setup.payment_method_type),
        status=str(setup.status),
        provider_customer_id=str(setup.provider_customer_id) if setup.provider_customer_id else None,
        provider_payment_method_reference=str(setup.provider_payment_method_reference) if setup.provider_payment_method_reference else None,
        provider_subscription_id=str(setup.provider_subscription_id) if setup.provider_subscription_id else None,
        billing_cycle=str(setup.billing_cycle) if setup.billing_cycle else None,
        created_at=setup.created_at,
        updated_at=setup.updated_at,
    )


def link_billing_setup_to_tenant(db: Session, protocol: str, restaurante_id: int) -> None:
    """Vincula o setup de cobrança ao tenant criado."""
    normalized = protocol.strip().upper()

    if db.get_bind().dialect.name == "postgresql":
        db.execute(
            text("SELECT koma_internal.link_saas_billing_setup_to_tenant(:protocol, :tenant_id)"),
            {"protocol": normalized, "tenant_id": restaurante_id},
        )
        return

    now = datetime.datetime.now(datetime.timezone.utc)
    db.query(SaaSBillingSetup).filter(
        SaaSBillingSetup.protocol == normalized
    ).update({"restaurante_id": restaurante_id, "updated_at": now})


def upsert_billing_setup(
    db: Session,
    *,
    protocol: str,
    contract_acceptance_id: str | None = None,
    provider: str = "mercado_pago",
    payment_method_type: str = "credit_card",
    status: str = "pending",
    provider_customer_id: str | None = None,
    provider_payment_method_reference: str | None = None,
    provider_subscription_id: str | None = None,
    billing_cycle: str | None = None,
) -> str | None:
    """Cria ou atualiza idempotentemente o setup de cobrança."""
    normalized = protocol.strip().upper()

    if db.get_bind().dialect.name == "postgresql":
        result = db.execute(
            text(
                "SELECT koma_internal.upsert_saas_billing_setup("
                ":protocol, :acceptance_id, :provider, :payment_method, "
                ":status, :customer_id, :payment_ref, :sub_id, :cycle)"
            ),
            {
                "protocol": normalized,
                "acceptance_id": contract_acceptance_id,
                "provider": provider or "mercado_pago",
                "payment_method": payment_method_type or "credit_card",
                "status": status or "pending",
                "customer_id": provider_customer_id,
                "payment_ref": provider_payment_method_reference,
                "sub_id": provider_subscription_id,
                "cycle": billing_cycle,
            },
        ).scalar()
        return str(result) if result else None

    now = datetime.datetime.now(datetime.timezone.utc)
    setup = db.query(SaaSBillingSetup).filter(SaaSBillingSetup.protocol == normalized).one_or_none()
    if setup:
        if contract_acceptance_id is not None:
            setup.contract_acceptance_id = contract_acceptance_id
        if provider:
            setup.provider = provider
        if payment_method_type:
            setup.payment_method_type = payment_method_type
        if status:
            setup.status = status
        if provider_customer_id is not None:
            setup.provider_customer_id = provider_customer_id
        if provider_payment_method_reference is not None:
            setup.provider_payment_method_reference = provider_payment_method_reference
        if provider_subscription_id is not None:
            setup.provider_subscription_id = provider_subscription_id
        if billing_cycle is not None:
            setup.billing_cycle = billing_cycle
        setup.updated_at = now
        db.flush()
        return str(setup.id)

    new_setup = SaaSBillingSetup(
        protocol=normalized,
        contract_acceptance_id=contract_acceptance_id,
        provider=provider or "mercado_pago",
        payment_method_type=payment_method_type or "credit_card",
        status=status or "pending",
        provider_customer_id=provider_customer_id,
        provider_payment_method_reference=provider_payment_method_reference,
        provider_subscription_id=provider_subscription_id,
        billing_cycle=billing_cycle,
        created_at=now,
        updated_at=now,
    )
    db.add(new_setup)
    db.flush()
    return str(new_setup.id)


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
    Avalia a assinatura formal; caso não exista, diferencia estritamente entre
    tenants legados (billing_mode='legacy') e novos tenants (billing_mode='subscription').
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

    # 2. Fallback de compatibilidade avaliando o restaurante
    restaurante = db.query(Restaurante).filter(Restaurante.id == restaurante_id).one_or_none()
    if restaurante is None:
        return TenantEntitlement(allowed=False, reason="tenant_not_found", billing_status="suspended")

    if getattr(restaurante, "saas_status", "active") == "suspended":
        return TenantEntitlement(allowed=False, reason="tenant_suspended", billing_status="suspended")

    billing_mode = getattr(restaurante, "billing_mode", "subscription") or "subscription"
    if billing_mode == "legacy":
        return TenantEntitlement(allowed=True, reason="legacy_grandfathered", billing_status="active")

    # Para novos restaurantes (billing_mode='subscription') sem assinatura válida:
    if is_billing_enforcement_enabled():
        return TenantEntitlement(
            allowed=False,
            reason="subscription_required",
            billing_status="subscription_required",
        )

    return TenantEntitlement(
        allowed=True,
        reason="enforcement_disabled_transitional",
        billing_status="pending",
    )
