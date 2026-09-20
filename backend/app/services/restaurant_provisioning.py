from __future__ import annotations

import datetime
import logging
import re
import unicodedata
import uuid
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from ..contract_models import RestaurantContractAcceptance
from ..database import tenant_session_scope
from ..models import ConfiguracaoRestaurante, Restaurante, SuperAdminAuditLog, Usuario
from ..routes.super_admin_onboarding import (
    DEFAULT_TRIAL_DAYS,
    _lock_onboarding_transaction,
    _reserve_restaurant_id,
    _slug_owner_id,
)
from ..saas_billing_models import SaaSSubscription
from ..services.billing_service import (
    BillingSetupData,
    contract_fixed_billing_required,
    link_billing_setup_to_tenant,
)
from ..subscription import VALID_SUBSCRIPTION_PLANS
from .onboarding_trial import ONBOARDING_SUBSCRIPTION_STATUS, pause_provider_during_onboarding
from .saas_billing_policy import (
    is_recurring_trial_payment_method,
    is_trial_eligible_payment_method,
)
from .saas_mercadopago import SaasMercadoPagoError

logger = logging.getLogger("koma.services.restaurant_provisioning")

INVITATION_TTL_HOURS = 72


def resolve_activation_acceptance(db: Session, protocol: str) -> dict[str, Any] | None:
    """Busca os dados do aceite contratual para ativação ou setup de billing."""
    from sqlalchemy import text
    from ..contract_models import ContractAcceptance
    from ..saas_billing_models import SaaSBillingSetup, SaaSPlanChange
    from .billing_service import get_billing_setup

    normalized = protocol.strip().upper()
    if db.get_bind().dialect.name == "postgresql":
        row = db.execute(
            text("SELECT * FROM koma_internal.resolve_contract_acceptance_for_activation(:protocol)"),
            {"protocol": normalized},
        ).mappings().one_or_none()
        if not row:
            return None
        res = dict(row)
        if "billing_status" not in res or not res["billing_status"]:
            billing = get_billing_setup(db, normalized)
            if billing:
                res["billing_status"] = billing.status
                res["billing_provider"] = billing.provider
                res["payment_method_type"] = billing.payment_method_type
            else:
                res["billing_status"] = "pending"
                res["billing_provider"] = None
                res["payment_method_type"] = None
        owner = db.execute(
            text(
                "SELECT koma_internal.plan_change_owner_for_acceptance(:acceptance_id)"
            ),
            {"acceptance_id": str(res.get("acceptance_id") or "")},
        ).scalar_one_or_none()
        res["plan_change_restaurante_id"] = int(owner) if owner is not None else None
        return res

    SaaSBillingSetup.__table__.create(db.get_bind(), checkfirst=True)
    SaaSSubscription.__table__.create(db.get_bind(), checkfirst=True)
    SaaSPlanChange.__table__.create(db.get_bind(), checkfirst=True)
    row = (
        db.query(ContractAcceptance, RestaurantContractAcceptance, SaaSBillingSetup)
        .outerjoin(
            RestaurantContractAcceptance,
            RestaurantContractAcceptance.acceptance_id == ContractAcceptance.id,
        )
        .outerjoin(
            SaaSBillingSetup,
            SaaSBillingSetup.protocol == ContractAcceptance.protocol,
        )
        .filter(ContractAcceptance.protocol == normalized)
        .one_or_none()
    )
    if row is None:
        return None
    acceptance, link, billing = row
    plan_change_owner_row = (
        db.query(SaaSPlanChange.restaurante_id)
        .filter(SaaSPlanChange.acceptance_id == str(acceptance.id))
        .one_or_none()
    )
    plan_change_owner = (
        int(plan_change_owner_row[0])
        if plan_change_owner_row is not None
        else None
    )
    return {
        "acceptance_id": acceptance.id,
        "protocol": acceptance.protocol,
        "plan": acceptance.plan,
        "billing_cycle": acceptance.billing_cycle,
        "restaurant_name": acceptance.restaurant_name,
        "contracting_party_name": acceptance.contracting_party_name,
        "representative_name": acceptance.representative_name,
        "email": acceptance.email,
        "phone": acceptance.phone,
        "linked_restaurante_id": link.restaurante_id if link else None,
        "linked_at": link.linked_at if link else None,
        "billing_status": billing.status if billing else "pending",
        "billing_provider": billing.provider if billing else None,
        "payment_method_type": billing.payment_method_type if billing else None,
        "plan_change_restaurante_id": plan_change_owner,
    }


def activation_slug(restaurant_name: str, protocol: str) -> str:
    """Gera um slug determinístico para o restaurante baseado no nome e protocolo."""
    ascii_name = unicodedata.normalize("NFKD", restaurant_name).encode("ascii", "ignore").decode("ascii")
    base = re.sub(r"[^a-z0-9]+", "-", ascii_name.lower()).strip("-") or "restaurante"
    suffix = protocol.rsplit("-", 1)[-1].lower()
    max_base_length = max(1, 100 - len(suffix) - 1)
    trimmed = base[:max_base_length].rstrip("-") or "restaurante"
    return f"{trimmed}-{suffix}"


def provision_restaurant_for_contract(
    db: Session,
    *,
    acceptance: dict[str, Any],
    billing_setup: BillingSetupData | None = None,
    actor: str = "saas_checkout",
    reason: str = "Ativação da conta com trial preservado até o início explícito da operação",
) -> dict[str, Any]:
    """
    Provisiona atomicamente o restaurante, configurações, admin inicial e assinatura SaaS.

    O tenant nasce em modo de implantação. Meios recorrentes ficam pausados no
    gateway; no Pix universal nenhuma cobrança é criada antes do vencimento. Os
    sete dias grátis só começam quando perfil, horários e cardápio estiverem
    prontos, sem consumir trial durante a implantação.
    """
    protocol = str(acceptance["protocol"]).strip().upper()
    if acceptance.get("plan_change_restaurante_id") is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Aceite de mudança de plano não pode ser usado para provisionamento inicial."
            ),
        )
    plan = str(acceptance.get("plan") or "").strip().lower()
    fixed_billing_required = contract_fixed_billing_required(db, protocol)
    if plan not in VALID_SUBSCRIPTION_PLANS:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="O plano congelado no aceite não é provisionável.",
        )

    restaurant_name = str(acceptance.get("restaurant_name") or "").strip()
    admin_name = str(
        acceptance.get("representative_name") or acceptance.get("contracting_party_name") or ""
    ).strip()
    admin_email = str(acceptance.get("email") or "").strip().lower()
    admin_phone = str(acceptance.get("phone") or "").strip() or None

    if len(restaurant_name) < 2 or len(admin_name) < 2:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="O aceite não contém dados suficientes para provisionamento automático.",
        )
    if not admin_email or "@" not in admin_email or len(admin_email) > 100:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="O e-mail do representante não é compatível com o cadastro de administrador.",
        )

    if (
        not fixed_billing_required
        and billing_setup is not None
        and billing_setup.provider_subscription_id
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Contrato sem componente fixo não pode ser provisionado com "
                "assinatura recorrente do provedor."
            ),
        )

    if (
        fixed_billing_required
        and billing_setup is not None
        and billing_setup.status == "ready"
        and not is_trial_eligible_payment_method(billing_setup.payment_method_type)
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "A contratação não possui um meio de pagamento elegível ao trial. "
                "Escolha cartão, Pix ou Saldo Mercado Pago."
            ),
        )

    tenant_id = _reserve_restaurant_id(db)
    slug = activation_slug(restaurant_name, protocol)

    with tenant_session_scope(db, tenant_id):
        _lock_onboarding_transaction(db)

        latest = resolve_activation_acceptance(db, protocol)
        if latest and latest.get("linked_restaurante_id"):
            existing_id = int(latest["linked_restaurante_id"])
            db.rollback()
            with tenant_session_scope(db, existing_id):
                restaurant = db.query(Restaurante).filter(Restaurante.id == existing_id).one()
                subscription = db.query(SaaSSubscription).filter(SaaSSubscription.restaurante_id == existing_id).one_or_none()
                return {
                    "restaurant_id": existing_id,
                    "slug": restaurant.slug,
                    "invitation_token": None,
                    "trial_ends_at": subscription.trial_ends_at if subscription else None,
                    "trial_status": subscription.status if subscription else None,
                }

        if _slug_owner_id(db, slug) is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="O subdomínio determinístico desta contratação já está em uso.",
            )

        now = datetime.datetime.now(datetime.timezone.utc)
        invitation_token = str(uuid.uuid4())

        # Meios recorrentes são autorizados na inscrição e pausados durante o
        # onboarding. Pix universal não possui mandato: nenhum pagamento é criado
        # aqui; o QR só nasce depois do trial, quando existir valor devido.
        if (
            fixed_billing_required
            and billing_setup is not None
            and billing_setup.status == "ready"
            and is_recurring_trial_payment_method(billing_setup.payment_method_type)
            and billing_setup.provider_subscription_id
        ):
            try:
                provider_result = pause_provider_during_onboarding(billing_setup.provider_subscription_id)
            except SaasMercadoPagoError as exc:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=(
                        "Não foi possível proteger o período grátis durante a implantação. "
                        "O restaurante não foi liberado e nenhuma cobrança foi antecipada; tente novamente."
                    ),
                ) from exc
            if str(provider_result.get("status") or "").strip().lower() != "paused":
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail="O gateway ainda não confirmou a pausa da recorrência durante a implantação.",
                )

        restaurant = Restaurante(
            id=tenant_id,
            nome=restaurant_name,
            slug=slug,
            plano=plan,
            saas_status="active",
            billing_mode="subscription",
        )
        db.add(restaurant)
        db.flush()

        db.add(
            ConfiguracaoRestaurante(
                restaurante_id=tenant_id,
                impressao_nome_restaurante=restaurant_name,
            )
        )

        initial_admin = Usuario(
            restaurante_id=tenant_id,
            nome=admin_name,
            telefone=admin_phone,
            email=admin_email,
            cargo="admin",
            status="pendente_ativacao",
            senha_hash=None,
            token_convite=invitation_token,
            token_expira_em=now + datetime.timedelta(hours=INVITATION_TTL_HOURS),
        )
        db.add(initial_admin)
        db.flush()

        link = RestaurantContractAcceptance(
            id=str(uuid.uuid4()),
            restaurante_id=tenant_id,
            acceptance_id=str(acceptance["acceptance_id"]),
            linked_at=now,
        )
        db.add(link)

        if billing_setup is not None:
            link_billing_setup_to_tenant(db, protocol, tenant_id)

        if (not fixed_billing_required) or (
            billing_setup is not None and billing_setup.status == "ready"
        ):
            canonical_sub = SaaSSubscription(
                restaurante_id=tenant_id,
                provider=billing_setup.provider if billing_setup is not None else "mercado_pago",
                provider_customer_id=(
                    billing_setup.provider_customer_id if billing_setup is not None else None
                ),
                provider_subscription_id=(
                    billing_setup.provider_subscription_id if billing_setup is not None else None
                ),
                payment_method_type=(
                    billing_setup.payment_method_type if billing_setup is not None else None
                ),
                status=(
                    ONBOARDING_SUBSCRIPTION_STATUS
                    if fixed_billing_required
                    else "active"
                ),
                billing_cycle=acceptance.get("billing_cycle") or "monthly",
                trial_started_at=None,
                trial_ends_at=None,
                current_period_start=None,
                current_period_end=None,
                created_at=now,
                updated_at=now,
            )
            db.add(canonical_sub)

        db.add(
            SuperAdminAuditLog(
                restaurante_id=tenant_id,
                actor=actor,
                action="SUPERADMIN_CONTRACT_ACTIVATE" if actor != "saas_checkout" else "ATOMIC_CONTRACT_ACTIVATE",
                reason=reason,
                before_data=None,
                after_data={
                    "protocol": protocol,
                    "acceptance_id": str(acceptance["acceptance_id"]),
                    "restaurante_id": tenant_id,
                    "slug": slug,
                    "plan": plan,
                    "billing_cycle": acceptance.get("billing_cycle") or "monthly",
                    "billing_status": (
                        billing_setup.status
                        if billing_setup is not None
                        else ("not_required" if not fixed_billing_required else "pending")
                    ),
                    "billing_provider": billing_setup.provider if billing_setup else None,
                    "payment_method_type": billing_setup.payment_method_type if billing_setup else None,
                    "trial_status": "pending_onboarding" if fixed_billing_required else "not_applicable",
                    "trial_days": DEFAULT_TRIAL_DAYS if fixed_billing_required else 0,
                    "trial_ends_at": None,
                    "admin_user_id": initial_admin.id,
                    "admin_email": admin_email,
                    "admin_status": "pendente_ativacao",
                    "credential_delivery": "outbox_scheduled",
                    "mercado_pago": "disconnected",
                },
            )
        )
        from .signup_notifications import enqueue_activation
        enqueue_activation(
            db,
            protocol=protocol,
            restaurant_name=restaurant_name,
            representative_name=admin_name,
            email=admin_email,
            phone=admin_phone,
            token=invitation_token,
        )
        db.commit()

        return {
            "restaurant_id": tenant_id,
            "slug": slug,
            "invitation_token": invitation_token,
            "admin_user_id": initial_admin.id,
            "admin_email": admin_email,
            "trial_ends_at": None,
            "trial_status": ONBOARDING_SUBSCRIPTION_STATUS if fixed_billing_required else "active",
        }
