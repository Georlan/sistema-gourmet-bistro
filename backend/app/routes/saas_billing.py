from __future__ import annotations

import datetime
import logging
import re
from decimal import Decimal, InvalidOperation
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db, tenant_session_scope
from ..models import Restaurante
from ..saas_billing_models import SaaSSubscription
from ..services.billing_service import (
    contract_billing_terms,
    contract_fixed_billing_required,
    get_billing_setup,
    get_billing_setup_by_provider_sub,
    upsert_billing_setup,
)
from ..services.onboarding_trial import pause_provider_during_onboarding
from ..services.restaurant_provisioning import (
    provision_restaurant_for_contract,
    resolve_activation_acceptance,
)
from ..services.saas_billing_policy import (
    RECURRING_TRIAL_PAYMENT_METHODS,
    SAAS_TRIAL_DAYS,
    is_recurring_trial_payment_method,
)
from ..services.saas_mercadopago import (
    SAAS_MERCADO_PAGO_WEBHOOK_PREFIX,
    SAAS_MERCADO_PAGO_WEBHOOK_SUBPATH,
    SaasMercadoPagoError,
    default_saas_mp_service,
)
from ..services.signup_notifications import enqueue_release_required

logger = logging.getLogger("koma.routes.saas_billing")

router = APIRouter(prefix="/api/contracts", tags=["SaaS Billing"])
webhook_router = APIRouter(prefix=SAAS_MERCADO_PAGO_WEBHOOK_PREFIX, tags=["SaaS Billing Webhook"])

_PROTOCOL_RE = re.compile(r"^KOMA-CTR-\d{8}-[A-F0-9]{12}$")
_MONEY_QUANTUM = Decimal("0.01")


class SaasBillingSetupRequest(BaseModel):
    payment_method_type: str = Field(min_length=3, max_length=30)
    card_token_id: str | None = None
    payer_email: str | None = None

    model_config = ConfigDict(extra="forbid")

    @field_validator("payment_method_type")
    @classmethod
    def validate_payment_method(cls, v: str) -> str:
        norm = v.strip().lower()
        if norm == "pix":
            raise ValueError(
                "Pix universal usa a seleção dedicada por QR Code e Pix Copia e Cola; "
                "nenhuma cobrança é criada antes do vencimento."
            )
        if norm not in RECURRING_TRIAL_PAYMENT_METHODS:
            raise ValueError(
                "Método de pagamento inválido. Use 'credit_card' ou 'account_money'; "
                "Pix universal possui seleção dedicada."
            )
        return norm


def _normalize_protocol(protocol: str) -> str:
    norm = protocol.strip().upper()
    if not _PROTOCOL_RE.fullmatch(norm):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Protocolo contratual inválido.",
        )
    return norm


def _normalized_money(value: object) -> Decimal | None:
    try:
        return Decimal(str(value)).quantize(_MONEY_QUANTUM)
    except (InvalidOperation, TypeError, ValueError):
        return None


def _validate_recurring_mandate(
    mandate: dict[str, Any],
    *,
    protocol: str,
    terms: dict[str, Any],
    payment_method_type: str,
) -> None:
    recurring = mandate.get("auto_recurring") or {}
    if str(mandate.get("external_reference") or "").strip().upper() != protocol:
        raise HTTPException(409, "A autorização recorrente não corresponde ao contrato.")
    if _normalized_money(recurring.get("transaction_amount")) != _normalized_money(terms["commercial"]["billingAmount"]):
        raise HTTPException(409, "A autorização recorrente possui valor diferente do contrato.")
    cycle = str(terms["commercial"].get("billingCycle") or "").strip().lower()
    expected_frequency = 12 if cycle in {"anual", "annual"} else 1
    if str(recurring.get("frequency") or "").strip() != str(expected_frequency) or str(recurring.get("frequency_type") or "").lower() != "months":
        raise HTTPException(409, "A autorização recorrente possui ciclo diferente do contrato.")
    if recurring.get("currency_id") != "BRL":
        raise HTTPException(409, "A autorização recorrente possui moeda incompatível com o contrato.")
    free_trial = recurring.get("free_trial") or {}
    if int(free_trial.get("frequency") or 0) != SAAS_TRIAL_DAYS or str(free_trial.get("frequency_type") or "").lower() != "days":
        raise HTTPException(409, "A autorização recorrente não preserva os 7 dias grátis obrigatórios.")
    if payment_method_type == "pix_automatic":
        provider_method = str(mandate.get("payment_method_id") or "").strip().lower()
        if provider_method != "pix":
            raise HTTPException(
                409,
                "A autorização concluída não é Pix Automático. Volte ao checkout e autorize a recorrência por Pix.",
            )
    elif payment_method_type == "account_money":
        provider_method = str(mandate.get("payment_method_id") or "").strip().lower()
        if provider_method != "account_money":
            raise HTTPException(
                409,
                "A autorização concluída não é Saldo Mercado Pago. Volte ao checkout e autorize usando sua conta Mercado Pago.",
            )
    elif payment_method_type == "credit_card":
        provider_method = str(mandate.get("payment_method_id") or "").strip().lower()
        if provider_method in ("pix", "account_money"):
            raise HTTPException(
                409,
                "A autorização concluída não é cartão de crédito. Volte ao checkout e informe um cartão válido.",
            )


def _pause_authorized_mandate_until_setup(preapproval_id: str) -> None:
    """Protege os 7 dias imediatamente após a autorização, antes até da liberação manual."""
    try:
        provider_result = pause_provider_during_onboarding(preapproval_id)
    except SaasMercadoPagoError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "A autorização foi confirmada, mas ainda não foi possível pausar a recorrência para proteger os 7 dias grátis. "
                "A inscrição ficou salva e nenhum restaurante foi liberado; tente novamente."
            ),
        ) from exc

    if str(provider_result.get("status") or "").strip().lower() != "paused":
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="O gateway ainda não confirmou a pausa da recorrência. A inscrição permanece salva e sem liberação.",
        )


@router.get("/payment-methods")
def available_payment_methods():
    return default_saas_mp_service.checkout_capabilities()


@router.post("/{protocol}/billing/activate-free")
def activate_contract_without_fixed_billing(
    protocol: str,
    db: Session = Depends(get_db),
):
    """Ativa contrato com billingAmount zero sem criar assinatura no provedor."""
    normalized_protocol = _normalize_protocol(protocol)
    acceptance = resolve_activation_acceptance(db, normalized_protocol)
    if acceptance is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Aceite contratual não encontrado para este protocolo.",
        )
    if acceptance.get("plan_change_restaurante_id") is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Este protocolo pertence a uma mudança de plano de tenant existente "
                "e não pode usar o checkout de contratação inicial."
            ),
        )

    existing_tenant_id = acceptance.get("linked_restaurante_id")
    if existing_tenant_id is not None:
        return {
            "success": True,
            "status": "already_activated",
            "restaurantId": str(existing_tenant_id),
            "message": "Este contrato já foi ativado previamente.",
        }

    if contract_fixed_billing_required(db, normalized_protocol):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Este contrato possui componente fixo e exige configuração de cobrança.",
        )

    existing = get_billing_setup(db, normalized_protocol)
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Existe configuração financeira associada a este contrato gratuito. "
                "Ela deve ser encerrada explicitamente antes da ativação sem mensalidade."
            ),
        )

    plan = str(acceptance.get("plan") or "pocket").lower()
    raw_cycle = str(acceptance.get("billing_cycle") or "mensal").lower()
    canonical_cycle = "annual" if raw_cycle in {"annual", "anual"} else "monthly"

    if settings.KOMA_SAAS_MANUAL_RELEASE_REQUIRED:
        enqueue_release_required(
            db,
            protocol=normalized_protocol,
            restaurant_name=str(acceptance.get("restaurant_name") or "Restaurante"),
            plan=plan,
            billing_cycle=canonical_cycle,
        )
        db.commit()
        return {
            "success": True,
            "status": "awaiting_release",
            "amountDueToday": 0,
            "trialDays": 0,
            "fixedBillingRequired": False,
            "message": (
                "Contratação registrada sem mensalidade fixa. "
                "Nenhuma assinatura recorrente foi criada no provedor."
            ),
        }

    provisioned = provision_restaurant_for_contract(
        db,
        acceptance=acceptance,
        billing_setup=None,
        actor="saas_checkout",
        reason="Ativação de contrato sem componente fixo; recorrência do provedor não aplicável",
    )
    return {
        "success": True,
        "status": "ready",
        "restaurantId": str(provisioned["restaurant_id"]),
        "slug": provisioned.get("slug"),
        "trialDays": 0,
        "trialStartsAfterSetup": False,
        "trialEndsAt": None,
        "activationToken": provisioned.get("invitation_token"),
        "amountDueToday": 0,
        "fixedBillingRequired": False,
        "message": (
            "Pocket ativado sem mensalidade fixa. "
            "Nenhuma assinatura recorrente foi criada no Mercado Pago."
        ),
    }


@router.post("/{protocol}/billing/setup")
def setup_contract_billing(
    protocol: str,
    payload: SaasBillingSetupRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    if payload.payment_method_type == "pix_automatic":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                "Pix Automático legado não está disponível para novas contratações. "
                "Use Pix por QR Code e Pix Copia e Cola."
            ),
        )
    from ..services.saas_checkout_lock import checkout_lock
    with checkout_lock(db, _normalize_protocol(protocol)):
        return _setup_contract_billing(protocol, payload, background_tasks, db)


def _setup_contract_billing(protocol, payload, background_tasks, db):
    """
    Configura exclusivamente meios recorrentes com a mesma regra comercial:
    autorização hoje, R$ 0 de mensalidade fixa durante a implantação e início
    dos 7 dias grátis somente quando os 3 passos essenciais estiverem prontos.
    """
    if not default_saas_mp_service.checkout_capabilities().get(payload.payment_method_type):
        raise HTTPException(503, "Inscrição salva. Este método recorrente está temporariamente indisponível; tente novamente mais tarde.")

    normalized_protocol = _normalize_protocol(protocol)
    acceptance = resolve_activation_acceptance(db, normalized_protocol)
    if acceptance is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Aceite contratual não encontrado para este protocolo.")
    if acceptance.get("plan_change_restaurante_id") is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Este protocolo pertence a uma mudança de plano de tenant existente "
                "e não pode criar billing setup de contratação inicial."
            ),
        )

    existing_tenant_id = acceptance.get("linked_restaurante_id")
    if existing_tenant_id is not None:
        return {
            "success": True,
            "status": "already_activated",
            "restaurantId": str(existing_tenant_id),
            "message": "Este contrato já foi ativado previamente.",
        }

    plan = str(acceptance.get("plan") or "pro").lower()
    raw_cycle = str(acceptance.get("billing_cycle") or "mensal").lower()
    is_annual = raw_cycle in ("annual", "anual")
    canonical_cycle = "annual" if is_annual else "monthly"
    terms = contract_billing_terms(db, normalized_protocol)
    if _normalized_money(terms["commercial"]["billingAmount"]) == Decimal("0.00"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Este contrato não possui mensalidade fixa. "
                "Use a ativação gratuita; nenhuma recorrência deve ser criada no provedor."
            ),
        )
    payer_email = (payload.payer_email or str(acceptance.get("email") or "")).strip().lower()
    if not payer_email or "@" not in payer_email:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="E-mail do pagador inválido.")

    existing = get_billing_setup(db, normalized_protocol)
    if existing and existing.status == "ready":
        if not is_recurring_trial_payment_method(existing.payment_method_type):
            raise HTTPException(409, "Pagamento antecipado legado não pode liberar uma nova assinatura. Configure um método recorrente.")
        if settings.KOMA_SAAS_MANUAL_RELEASE_REQUIRED:
            enqueue_release_required(
                db,
                protocol=normalized_protocol,
                restaurant_name=str(acceptance.get("restaurant_name") or "Restaurante"),
                plan=plan,
                billing_cycle=canonical_cycle,
            )
            db.commit()
            return {
                "success": True,
                "status": "awaiting_release",
                "message": "Autorização recorrente confirmada e pausada para proteger o período grátis. A equipe KÔMA foi avisada e fará a liberação do restaurante.",
            }
        provision_res = provision_restaurant_for_contract(db, acceptance=acceptance, billing_setup=existing, actor="saas_checkout")
        trial_ends_at = provision_res.get("trial_ends_at")
        return {
            "success": True,
            "status": "ready",
            "restaurantId": str(provision_res["restaurant_id"]),
            "slug": provision_res["slug"],
            "trialDays": SAAS_TRIAL_DAYS,
            "trialStartsAfterSetup": True,
            "trialEndsAt": trial_ends_at.isoformat() if trial_ends_at else None,
            "activationToken": provision_res.get("invitation_token"),
        }

    if existing and existing.status == "pending" and is_recurring_trial_payment_method(existing.payment_method_type):
        if existing.payment_method_type != payload.payment_method_type:
            raise HTTPException(409, "Já existe uma autorização recorrente pendente. Conclua ou cancele antes de trocar o método.")
        try:
            recovered = (
                default_saas_mp_service.get_preapproval(existing.provider_subscription_id)
                if existing.provider_subscription_id
                else default_saas_mp_service.find_preapproval(normalized_protocol, payer_email)
            )
        except SaasMercadoPagoError as exc:
            raise HTTPException(502, "Ainda não foi possível confirmar a autorização anterior. Nenhuma nova cobrança foi criada.") from exc

        if recovered and str(recovered.get("status") or "").lower() == "authorized":
            _validate_recurring_mandate(
                recovered,
                protocol=normalized_protocol,
                terms=terms,
                payment_method_type=existing.payment_method_type,
            )
            recovered_id = str(recovered["id"])
            upsert_billing_setup(
                db,
                protocol=normalized_protocol,
                status="pending",
                payment_method_type=existing.payment_method_type,
                provider_subscription_id=recovered_id,
                provider_customer_id=str(recovered.get("payer_id") or "") or None,
                billing_cycle=canonical_cycle,
            )
            db.commit()
            _pause_authorized_mandate_until_setup(recovered_id)
            upsert_billing_setup(
                db,
                protocol=normalized_protocol,
                status="ready",
                payment_method_type=existing.payment_method_type,
                provider_subscription_id=recovered_id,
                provider_customer_id=str(recovered.get("payer_id") or "") or None,
                billing_cycle=canonical_cycle,
            )
            db.commit()
            return _setup_contract_billing(protocol, payload, background_tasks, db)

        if existing.payment_method_type in ("pix_automatic", "account_money") and recovered:
            authorization_url = str(recovered.get("init_point") or "").strip()
            method_label = "Saldo Mercado Pago" if existing.payment_method_type == "account_money" else "Pix Automático"
            return {
                "success": True,
                "status": "authorization_required",
                "paymentMethodType": existing.payment_method_type,
                "subscriptionId": existing.provider_subscription_id,
                "authorizationUrl": authorization_url or None,
                "amountDueToday": 0,
                "trialDays": SAAS_TRIAL_DAYS,
                "message": f"Autorize o {method_label}. Os 7 dias grátis começam somente depois da implantação essencial.",
            }

        raise HTTPException(409, "A autorização anterior ainda está em confirmação. Aguarde antes de tentar novamente.")

    if existing and existing.status == "pending" and not is_recurring_trial_payment_method(existing.payment_method_type):
        raise HTTPException(409, "Existe um pagamento antecipado legado pendente. Ele não será usado para liberar esta assinatura; suporte precisa encerrá-lo antes de continuar.")

    amount = Decimal(terms["commercial"]["billingAmount"])

    if payload.payment_method_type == "credit_card":
        card_token_id = (payload.card_token_id or "").strip()
        if not card_token_id:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="card_token_id é obrigatório para cartão de crédito.")

        upsert_billing_setup(
            db,
            protocol=normalized_protocol,
            contract_acceptance_id=str(acceptance["acceptance_id"]),
            payment_method_type="credit_card",
            status="pending",
            billing_cycle=canonical_cycle,
        )
        db.commit()
        try:
            mp_res = default_saas_mp_service.create_preapproval(
                protocol=normalized_protocol,
                plan=plan,
                billing_cycle=canonical_cycle,
                amount=amount,
                card_token_id=card_token_id,
                payer_email=payer_email,
                trial_days=SAAS_TRIAL_DAYS,
            )
        except SaasMercadoPagoError as exc:
            outcome = "failed" if exc.status_code is not None and 400 <= exc.status_code < 500 else "pending"
            upsert_billing_setup(db, protocol=normalized_protocol, payment_method_type="credit_card", status=outcome, billing_cycle=canonical_cycle)
            db.commit()
            raise HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail=str(exc)) from exc

        if str(mp_res.get("status") or "").lower() != "authorized" or not mp_res.get("id"):
            upsert_billing_setup(
                db,
                protocol=normalized_protocol,
                payment_method_type="credit_card",
                status="pending",
                provider_subscription_id=str(mp_res["id"]) if mp_res.get("id") else None,
                billing_cycle=canonical_cycle,
            )
            db.commit()
            raise HTTPException(402, "O provedor ainda não autorizou a assinatura. Nenhuma cobrança antecipada foi feita.")

        _validate_recurring_mandate(mp_res, protocol=normalized_protocol, terms=terms, payment_method_type="credit_card")
        provider_subscription_id = str(mp_res["id"])
        upsert_billing_setup(
            db,
            protocol=normalized_protocol,
            contract_acceptance_id=str(acceptance.get("acceptance_id")),
            provider="mercado_pago",
            payment_method_type="credit_card",
            status="pending",
            provider_customer_id=str(mp_res.get("payer_id") or "") or None,
            provider_subscription_id=provider_subscription_id,
            billing_cycle=canonical_cycle,
        )
        db.commit()
        _pause_authorized_mandate_until_setup(provider_subscription_id)
        upsert_billing_setup(
            db,
            protocol=normalized_protocol,
            contract_acceptance_id=str(acceptance.get("acceptance_id")),
            provider="mercado_pago",
            payment_method_type="credit_card",
            status="ready",
            provider_customer_id=str(mp_res.get("payer_id") or "") or None,
            provider_subscription_id=provider_subscription_id,
            billing_cycle=canonical_cycle,
        )
        db.commit()
        return _setup_contract_billing(protocol, payload, background_tasks, db)

    if payload.payment_method_type == "pix_automatic":
        upsert_billing_setup(
            db,
            protocol=normalized_protocol,
            contract_acceptance_id=str(acceptance["acceptance_id"]),
            provider="mercado_pago",
            payment_method_type="pix_automatic",
            status="pending",
            billing_cycle=canonical_cycle,
        )
        db.commit()
        try:
            mp_res = default_saas_mp_service.create_pix_automatic_preapproval(
                protocol=normalized_protocol,
                plan=plan,
                billing_cycle=canonical_cycle,
                amount=amount,
                payer_email=payer_email,
                trial_days=SAAS_TRIAL_DAYS,
            )
        except SaasMercadoPagoError as exc:
            upsert_billing_setup(db, protocol=normalized_protocol, payment_method_type="pix_automatic", status="failed", billing_cycle=canonical_cycle)
            db.commit()
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

        sub_id = str(mp_res.get("id") or "").strip()
        authorization_url = str(mp_res.get("init_point") or "").strip()
        if not sub_id or not authorization_url:
            upsert_billing_setup(db, protocol=normalized_protocol, payment_method_type="pix_automatic", status="failed", billing_cycle=canonical_cycle)
            db.commit()
            raise HTTPException(502, "O gateway não retornou a autorização do Pix Automático.")

        upsert_billing_setup(
            db,
            protocol=normalized_protocol,
            contract_acceptance_id=str(acceptance["acceptance_id"]),
            provider="mercado_pago",
            payment_method_type="pix_automatic",
            status="pending",
            provider_subscription_id=sub_id,
            billing_cycle=canonical_cycle,
        )
        db.commit()
        return {
            "success": True,
            "status": "authorization_required",
            "paymentMethodType": "pix_automatic",
            "subscriptionId": sub_id,
            "authorizationUrl": authorization_url,
            "amountDueToday": 0,
            "trialDays": SAAS_TRIAL_DAYS,
            "message": "Autorize o Pix Automático no ambiente seguro do Mercado Pago. Os 7 dias grátis começam somente depois da implantação essencial.",
        }

    if payload.payment_method_type == "account_money":
        upsert_billing_setup(
            db,
            protocol=normalized_protocol,
            contract_acceptance_id=str(acceptance["acceptance_id"]),
            provider="mercado_pago",
            payment_method_type="account_money",
            status="pending",
            billing_cycle=canonical_cycle,
        )
        db.commit()
        try:
            mp_res = default_saas_mp_service.create_account_money_preapproval(
                protocol=normalized_protocol,
                plan=plan,
                billing_cycle=canonical_cycle,
                amount=amount,
                payer_email=payer_email,
                trial_days=SAAS_TRIAL_DAYS,
            )
        except SaasMercadoPagoError as exc:
            upsert_billing_setup(db, protocol=normalized_protocol, payment_method_type="account_money", status="failed", billing_cycle=canonical_cycle)
            db.commit()
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

        sub_id = str(mp_res.get("id") or "").strip()
        authorization_url = str(mp_res.get("init_point") or "").strip()
        if not sub_id or not authorization_url:
            upsert_billing_setup(db, protocol=normalized_protocol, payment_method_type="account_money", status="failed", billing_cycle=canonical_cycle)
            db.commit()
            raise HTTPException(502, "O gateway não retornou a autorização do Saldo Mercado Pago.")

        upsert_billing_setup(
            db,
            protocol=normalized_protocol,
            contract_acceptance_id=str(acceptance["acceptance_id"]),
            provider="mercado_pago",
            payment_method_type="account_money",
            status="pending",
            provider_subscription_id=sub_id,
            billing_cycle=canonical_cycle,
        )
        db.commit()
        return {
            "success": True,
            "status": "authorization_required",
            "paymentMethodType": "account_money",
            "subscriptionId": sub_id,
            "authorizationUrl": authorization_url,
            "amountDueToday": 0,
            "trialDays": SAAS_TRIAL_DAYS,
            "message": "Autorize a assinatura com seu Saldo Mercado Pago no ambiente seguro. Os 7 dias grátis começam somente depois da implantação essencial.",
        }

    raise HTTPException(422, "Método recorrente não suportado.")


@router.get("/{protocol}/billing/status")
def get_contract_billing_status(protocol: str, db: Session = Depends(get_db)):
    normalized_protocol = _normalize_protocol(protocol)
    acceptance = resolve_activation_acceptance(db, normalized_protocol)
    if acceptance is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Aceite contratual não encontrado para este protocolo.")

    billing = get_billing_setup(db, normalized_protocol)
    fixed_billing_required = contract_fixed_billing_required(db, normalized_protocol)
    linked_tenant_id = acceptance.get("linked_restaurante_id")
    restaurant_slug = None
    if linked_tenant_id is not None:
        with tenant_session_scope(db, linked_tenant_id):
            restaurant = db.query(Restaurante).filter(Restaurante.id == linked_tenant_id).one_or_none()
            restaurant_slug = str(restaurant.slug) if restaurant and restaurant.slug else None

    return {
        "protocol": normalized_protocol,
        "billingStatus": billing.status if billing else ("pending" if fixed_billing_required else "not_required"),
        "provider": billing.provider if billing else None,
        "paymentMethodType": billing.payment_method_type if billing else None,
        "isActivated": linked_tenant_id is not None,
        "restaurantId": str(linked_tenant_id) if linked_tenant_id else None,
        "slug": restaurant_slug,
    }


@webhook_router.post(SAAS_MERCADO_PAGO_WEBHOOK_SUBPATH)
async def mercado_pago_saas_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    x_signature: str | None = Header(default=None),
    x_request_id: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Reconcilia autorizações/faturas recorrentes. Pix avulso legado nunca ativa novas assinaturas."""
    try:
        payload = await request.json()
    except Exception:
        payload = {}

    query_data_id = (request.query_params.get("data.id") or request.query_params.get("id") or "").strip()
    raw_data = payload.get("data") if isinstance(payload, dict) else None
    data = raw_data if isinstance(raw_data, dict) else {}
    body_data_id = str(data.get("id") or (payload.get("id") if isinstance(payload, dict) else "") or "").strip()
    data_id = query_data_id or body_data_id

    event_type = str(
        request.query_params.get("type")
        or request.query_params.get("topic")
        or (payload.get("type") if isinstance(payload, dict) else "")
        or (payload.get("action") if isinstance(payload, dict) else "")
        or ""
    ).strip().lower()

    if not data_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Notificação inválida.")

    sig_header = (x_signature or request.headers.get("x-signature") or "").strip()
    req_id = (x_request_id or request.headers.get("x-request-id") or "").strip()

    if not default_saas_mp_service.verify_webhook_signature(
        signature_header=sig_header,
        request_id=req_id,
        data_id=data_id,
    ):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Assinatura de webhook do Mercado Pago inválida.")

    logger.info("SaaS Mercado Pago webhook received event=%s data_id=%s", event_type, data_id)

    if event_type == "subscription_authorized_payment":
        from ..services.saas_invoice_reconciliation import reconcile_invoice
        return reconcile_invoice(db, data_id)

    if "preapproval" in event_type or payload.get("entity") == "preapproval":
        sub_id = data_id
        if sub_id:
            billing = get_billing_setup_by_provider_sub(db, "mercado_pago", sub_id)
            if billing is None:
                try:
                    mandate = default_saas_mp_service.get_preapproval(sub_id)
                except SaasMercadoPagoError as exc:
                    if exc.status_code in {400, 404}:
                        logger.info("Preapproval %s not found on Mercado Pago (simulation or unknown ID).", sub_id)
                        return {"status": "received", "ignored": True, "reason": "preapproval_not_found"}
                    raise HTTPException(502, "Não foi possível recuperar a autorização.") from exc
                reference = str(mandate.get("external_reference") or "").strip().upper()
                if _PROTOCOL_RE.fullmatch(reference):
                    pending = get_billing_setup(db, reference)
                    if pending and pending.status == "pending" and is_recurring_trial_payment_method(pending.payment_method_type) and not pending.provider_subscription_id:
                        upsert_billing_setup(
                            db,
                            protocol=reference,
                            status="pending",
                            provider_subscription_id=sub_id,
                            billing_cycle=pending.billing_cycle,
                        )
                        db.commit()
                        billing = get_billing_setup(db, reference)
                    elif pending is None:
                        raise HTTPException(503, "Autorização ainda não associada. Reenvie a notificação.")

            if billing and not billing.restaurante_id and is_recurring_trial_payment_method(billing.payment_method_type):
                from ..services.saas_checkout_lock import checkout_lock
                with checkout_lock(db, billing.protocol):
                    _setup_contract_billing(
                        billing.protocol,
                        SaasBillingSetupRequest(payment_method_type=billing.payment_method_type),
                        background_tasks,
                        db,
                    )

            if billing and billing.restaurante_id:
                with tenant_session_scope(db, billing.restaurante_id):
                    saas_sub = db.query(SaaSSubscription).filter(SaaSSubscription.restaurante_id == billing.restaurante_id).one_or_none()
                    if saas_sub:
                        try:
                            mp_data = default_saas_mp_service.get_preapproval(sub_id)
                        except SaasMercadoPagoError as exc:
                            raise HTTPException(502, "Não foi possível consultar a assinatura.") from exc
                        mp_status = str(mp_data.get("status") or "").lower()
                        if mp_status == "paused":
                            saas_sub.status = "onboarding" if saas_sub.trial_started_at is None else "suspended"
                        elif mp_status in {"cancelled", "canceled"}:
                            saas_sub.status = "canceled"
                        saas_sub.updated_at = datetime.datetime.now(datetime.timezone.utc)
                        db.commit()

    elif "payment" in event_type:
        payment_id = data_id
        if payment_id:
            billing = get_billing_setup_by_provider_sub(db, "mercado_pago", payment_id)
            if billing and billing.payment_method_type == "pix":
                logger.warning("Legacy upfront Pix payment ignored for subscription activation protocol=%s", billing.protocol)
                return {"status": "received", "activated": False, "reason": "legacy_upfront_pix_disabled"}
            # Cobranças recorrentes normais são conciliadas pelo evento subscription_authorized_payment.
            return {"status": "received", "activated": False, "reason": "recurring_invoice_event_required"}

    return {"status": "received"}
