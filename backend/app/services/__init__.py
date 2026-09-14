# Services package

# Instala o gateway de planos hospedados antes que as rotas importem a instância
# canônica do Mercado Pago. O cartão continua usando o comportamento da classe
# base; somente Pix Automático e Saldo Mercado Pago ganham o caminho alternativo
# via `/preapproval_plan`.
from . import billing_service as _billing_service
from . import saas_mercadopago as _saas_mercadopago
from .saas_mercadopago_hosted_plans import (
    default_saas_mp_service as _hosted_saas_mp_service,
    is_hosted_plan_provider_id as _is_hosted_plan_provider_id,
)

_saas_mercadopago.default_saas_mp_service = _hosted_saas_mp_service

_original_upsert_billing_setup = _billing_service.upsert_billing_setup
_original_get_billing_setup_by_provider_sub = _billing_service.get_billing_setup_by_provider_sub


def _hosted_plan_aware_upsert_billing_setup(
    db,
    *,
    protocol,
    contract_acceptance_id=None,
    provider="mercado_pago",
    payment_method_type="credit_card",
    status="pending",
    provider_customer_id=None,
    provider_payment_method_reference=None,
    provider_subscription_id=None,
    billing_cycle=None,
):
    """Mantém Plan ID separado do ID real da assinatura.

    As rotas existentes tratam `provider_subscription_id` como um preapproval
    consultável e pausável. Um `preapproval_plan` ainda não é uma assinatura;
    portanto `plan:<id>` fica em `provider_payment_method_reference` até o
    checkout hospedado criar o preapproval real.
    """
    if _is_hosted_plan_provider_id(provider_subscription_id):
        provider_payment_method_reference = str(provider_subscription_id).strip()
        provider_subscription_id = None

    return _original_upsert_billing_setup(
        db,
        protocol=protocol,
        contract_acceptance_id=contract_acceptance_id,
        provider=provider,
        payment_method_type=payment_method_type,
        status=status,
        provider_customer_id=provider_customer_id,
        provider_payment_method_reference=provider_payment_method_reference,
        provider_subscription_id=provider_subscription_id,
        billing_cycle=billing_cycle,
    )


def _hosted_plan_aware_get_billing_setup_by_provider_sub(db, provider, sub_id):
    """Reconcilia a assinatura criada pelo checkout com seu plano local.

    O primeiro webhook chega com o ID do preapproval real. Se ele ainda não foi
    persistido, consultamos o objeto no Mercado Pago, obtemos
    `preapproval_plan_id`, localizamos o marcador `plan:<id>` e vinculamos o ID
    real de forma transacional antes de devolver o setup à rota existente.
    """
    direct = _original_get_billing_setup_by_provider_sub(db, provider, sub_id)
    if direct is not None or provider != "mercado_pago" or _is_hosted_plan_provider_id(sub_id):
        return direct

    try:
        mandate = _hosted_saas_mp_service.get_preapproval(str(sub_id))
    except _saas_mercadopago.SaasMercadoPagoError:
        return None

    plan_id = str(mandate.get("preapproval_plan_id") or "").strip()
    if not plan_id:
        return None

    plan_reference = f"plan:{plan_id}"
    pending = _original_get_billing_setup_by_provider_sub(db, provider, plan_reference)
    if pending is None:
        return None

    _original_upsert_billing_setup(
        db,
        protocol=pending.protocol,
        contract_acceptance_id=pending.contract_acceptance_id,
        provider=pending.provider,
        payment_method_type=pending.payment_method_type,
        status=pending.status,
        provider_customer_id=str(mandate.get("payer_id") or "").strip() or pending.provider_customer_id,
        provider_payment_method_reference=plan_reference,
        provider_subscription_id=str(mandate.get("id") or sub_id).strip(),
        billing_cycle=pending.billing_cycle,
    )
    db.flush()
    return _original_get_billing_setup_by_provider_sub(db, provider, str(mandate.get("id") or sub_id).strip())


_billing_service.upsert_billing_setup = _hosted_plan_aware_upsert_billing_setup
_billing_service.get_billing_setup_by_provider_sub = _hosted_plan_aware_get_billing_setup_by_provider_sub
