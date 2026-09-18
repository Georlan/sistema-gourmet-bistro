from __future__ import annotations

import datetime
import json
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from ..config import settings
from ..models import Restaurante
from ..saas_billing_models import SaaSBillingSetup, SaaSSubscription
from ..subscription import legacy_v25_marketplace_rate


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


@dataclass(frozen=True)
class TenantCommercialTerms:
    """Snapshot comercial aceito pelo tenant, independente do catálogo vigente."""

    protocol: str
    plan: str
    billing_cycle: str
    fixed_monthly_price: Decimal
    billing_amount: Decimal
    annual_monthly_equivalent: Decimal | None
    marketplace_rate: Decimal
    legal_version: str
    pricing_version: str | None = None


def _commercial_decimal(value: Any, *, field: str, allow_none: bool = False) -> Decimal | None:
    if value is None and allow_none:
        return None
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise RuntimeError(f"Termo comercial inválido no comprovante: {field}.") from exc
    if not parsed.is_finite():
        raise RuntimeError(f"Termo comercial inválido no comprovante: {field}.")
    return parsed


def tenant_commercial_terms(
    db: Session,
    restaurante_id: int,
) -> TenantCommercialTerms | None:
    """Resolve o último aceite vinculado ao tenant.

    None significa somente que o tenant não possui aceite vinculado e, portanto,
    deve seguir o fallback legado explicitamente congelado. Se existir um aceite
    mas o snapshot estiver inválido, falhamos fechado em vez de recalcular pelo
    slug atual do plano.
    """

    from ..contract_models import ContractAcceptance, RestaurantContractAcceptance
    from ..crypt import decrypt_field

    protocol = ""
    raw_receipt: str | None = None

    if db.get_bind().dialect.name == "postgresql":
        row = db.execute(
            text("SELECT * FROM koma_internal.current_contract_receipt()")
        ).mappings().one_or_none()
        if row is None:
            return None
        protocol = str(row.get("protocol") or "")
        raw_receipt = row.get("receipt_snapshot_encrypted")
    else:
        link = (
            db.query(RestaurantContractAcceptance)
            .filter(RestaurantContractAcceptance.restaurante_id == restaurante_id)
            .order_by(
                RestaurantContractAcceptance.linked_at.desc(),
                RestaurantContractAcceptance.id.desc(),
            )
            .first()
        )
        if link is None:
            return None
        acceptance = db.get(ContractAcceptance, link.acceptance_id)
        if acceptance is None:
            raise RuntimeError(
                "Aceite contratual vinculado ao tenant não foi encontrado."
            )
        protocol = str(acceptance.protocol or "")
        raw_receipt = acceptance.receipt_snapshot_encrypted

    if not raw_receipt:
        raise RuntimeError("Comprovante contratual vinculado ao tenant está indisponível.")

    try:
        receipt = json.loads(decrypt_field(raw_receipt))
        commercial = receipt["commercial"]
        documents = receipt["documents"]
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise RuntimeError("Comprovante contratual comercial inválido.") from exc

    fixed_monthly_price = _commercial_decimal(
        commercial.get("fixedMonthlyPrice"),
        field="fixedMonthlyPrice",
    )
    billing_amount = _commercial_decimal(
        commercial.get("billingAmount"),
        field="billingAmount",
    )
    annual_monthly_equivalent = _commercial_decimal(
        commercial.get("annualMonthlyEquivalent"),
        field="annualMonthlyEquivalent",
        allow_none=True,
    )
    marketplace_rate = _commercial_decimal(
        commercial.get("marketplaceRate"),
        field="marketplaceRate",
    )

    assert fixed_monthly_price is not None
    assert billing_amount is not None
    assert marketplace_rate is not None
    if fixed_monthly_price < 0 or billing_amount < 0:
        raise RuntimeError("Comprovante contratual contém valor financeiro negativo.")
    if marketplace_rate < 0 or marketplace_rate > 1:
        raise RuntimeError("Comprovante contratual contém taxa transacional inválida.")

    plan = str(commercial.get("plan") or "").strip().lower()
    billing_cycle = str(commercial.get("billingCycle") or "").strip().lower()
    legal_version = str(documents.get("version") or "").strip()
    if not protocol or not plan or not billing_cycle or not legal_version:
        raise RuntimeError("Comprovante contratual comercial está incompleto.")

    return TenantCommercialTerms(
        protocol=protocol,
        plan=plan,
        billing_cycle=billing_cycle,
        fixed_monthly_price=fixed_monthly_price,
        billing_amount=billing_amount,
        annual_monthly_equivalent=annual_monthly_equivalent,
        marketplace_rate=marketplace_rate,
        legal_version=legal_version,
        pricing_version=str(commercial.get("pricingVersion") or "").strip() or None,
    )


def tenant_marketplace_rate(db: Session, restaurant: Restaurante) -> Decimal:
    """Resolve a taxa comercial efetiva sem consultar o catálogo vigente.

    Tenants contratados usam sempre o snapshot do aceite mais recente. Somente
    tenants explicitamente legados, ainda sem aceite, podem usar o fallback v2.5.
    Um tenant de assinatura sem aceite falha fechado para impedir que uma troca
    isolada de restaurante.plano altere a taxa financeira.
    """
    terms = tenant_commercial_terms(db, int(restaurant.id))
    if terms is not None:
        return terms.marketplace_rate

    billing_mode = str(getattr(restaurant, "billing_mode", "") or "").strip().lower()
    if billing_mode == "legacy":
        return legacy_v25_marketplace_rate(restaurant.plano)

    raise RuntimeError(
        "Tenant de assinatura sem aceite comercial vinculado; "
        "a taxa transacional não pode ser inferida pelo plano salvo."
    )


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
            (SaaSBillingSetup.provider_subscription_id == sub_id)
            | (SaaSBillingSetup.provider_payment_method_reference == sub_id),
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


def contract_fixed_billing_required(db: Session, protocol: str) -> bool:
    """Retorna se o snapshot aceito possui componente fixo a cobrar."""
    terms = contract_billing_terms(db, protocol.strip().upper())
    commercial = terms.get("commercial") or {}
    amount = _commercial_decimal(commercial.get("billingAmount"), field="billingAmount")
    if amount is None or amount < 0:
        raise RuntimeError("Comprovante contratual contém billingAmount inválido.")
    return amount > 0


def is_billing_ready(db: Session, protocol: str) -> bool:
    """
    Billing é considerado pronto quando o provider foi configurado OU quando o
    próprio snapshot contratado declara billingAmount = 0.
    """
    setup = get_billing_setup(db, protocol)
    if setup is not None and str(setup.status).strip().lower() == "ready":
        return True
    try:
        return not contract_fixed_billing_required(db, protocol)
    except Exception:
        return False


def resolve_tenant_entitlement(db: Session, restaurante_id: int) -> TenantEntitlement:
    """
    Fonte canônica de autoridade sobre o acesso do tenant às operações (Caixa/Salão).
    Avalia a assinatura formal; caso não exista, diferencia estritamente entre
    tenants legados (billing_mode='legacy') e novos tenants (billing_mode='subscription').
    """
    now = datetime.datetime.now(datetime.timezone.utc)

    # Suspensão administrativa do tenant tem precedência sobre qualquer estado
    # financeiro. Billing ativo/onboarding nunca pode reabrir um restaurante
    # explicitamente suspenso pelo control plane.
    restaurante = (
        db.query(Restaurante)
        .filter(Restaurante.id == restaurante_id)
        .one_or_none()
    )
    if restaurante is None:
        return TenantEntitlement(
            allowed=False,
            reason="tenant_not_found",
            billing_status="suspended",
        )
    if str(getattr(restaurante, "saas_status", "active") or "active").lower() == "suspended":
        return TenantEntitlement(
            allowed=False,
            reason="tenant_suspended",
            billing_status="suspended",
        )

    # 1. Verifica se há assinatura canônica em saas_subscriptions
    sub = (
        db.query(SaaSSubscription)
        .filter(SaaSSubscription.restaurante_id == restaurante_id)
        .one_or_none()
    )
    if sub is not None:
        sub_status = str(sub.status or "").strip().lower()
        if sub_status == "active":
            ends_at = sub.current_period_end
            if ends_at is not None and ends_at.tzinfo is None:
                ends_at = ends_at.replace(tzinfo=datetime.timezone.utc)
            if ends_at is not None and now > ends_at:
                return TenantEntitlement(allowed=False, reason="paid_period_expired", billing_status="past_due")
            return TenantEntitlement(allowed=True, reason="subscription_active", billing_status="active")

        if sub_status == "trialing":
            ends_at = sub.trial_ends_at
            if ends_at is not None and ends_at.tzinfo is None:
                ends_at = ends_at.replace(tzinfo=datetime.timezone.utc)
            if ends_at is None or now <= ends_at:
                return TenantEntitlement(allowed=True, reason="trial_active", billing_status="trialing")
            return TenantEntitlement(allowed=False, reason="trial_expired", billing_status="past_due")

        # Durante a implantação a autorização recorrente fica pausada no provedor.
        # O acesso às telas de configuração precisa continuar liberado, enquanto o
        # gate de onboarding impede Vendas/Caixa até o 3/3. Um webhook de pausa pode
        # temporariamente refletir "suspended" localmente; sem datas de período isso
        # ainda representa implantação, não inadimplência/suspensão administrativa.
        if sub_status == "onboarding" or (
            sub_status == "suspended"
            and sub.trial_started_at is None
            and sub.current_period_start is None
        ):
            return TenantEntitlement(
                allowed=True,
                reason="onboarding_setup",
                billing_status="onboarding",
            )

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

    # 2. Fallback de compatibilidade usando o tenant já validado acima.
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


def contract_billing_terms(db, protocol):
    import json
    from ..crypt import decrypt_field
    from ..contract_models import ContractAcceptance
    if db.get_bind().dialect.name == "postgresql":
        raw = db.execute(text("SELECT koma_internal.contract_terms_for_billing(:protocol)"), {"protocol": protocol}).scalar()
    else:
        row = db.query(ContractAcceptance).filter(ContractAcceptance.protocol == protocol).one_or_none()
        raw = row.receipt_snapshot_encrypted if row else None
    if not raw:
        from fastapi import HTTPException
        raise HTTPException(409, "Comprovante contratual indisponível para cobrança.")
    return json.loads(decrypt_field(raw))
