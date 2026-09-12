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
from ..database import SessionLocal, get_db, tenant_session_scope
from ..models import Restaurante
from ..saas_billing_models import SaaSSubscription
from ..services.billing_service import (
    contract_billing_terms,
    get_billing_setup,
    get_billing_setup_by_provider_sub,
    upsert_billing_setup,
)
from ..services.restaurant_provisioning import (
    provision_restaurant_for_contract,
    resolve_activation_acceptance,
)
from ..services.saas_mercadopago import (
    SaasMercadoPagoError,
    default_saas_mp_service,
)
from ..subscription import subscription_annual_total, subscription_monthly_price

logger = logging.getLogger("koma.routes.saas_billing")

router = APIRouter(prefix="/api/contracts", tags=["SaaS Billing"])
webhook_router = APIRouter(prefix="/api/integrations/saas-billing/mercado-pago", tags=["SaaS Billing Webhook"])

_PROTOCOL_RE = re.compile(r"^KOMA-CTR-\d{8}-[A-F0-9]{12}$")
_MONEY_QUANTUM = Decimal("0.01")


class SaasBillingSetupRequest(BaseModel):
    payment_method_type: str = Field(min_length=3, max_length=20)  # credit_card | pix
    card_token_id: str | None = None
    payer_email: str | None = None

    model_config = ConfigDict(extra="forbid")

    @field_validator("payment_method_type")
    @classmethod
    def validate_payment_method(cls, v: str) -> str:
        norm = v.strip().lower()
        if norm not in {"credit_card", "pix"}:
            raise ValueError("Método de pagamento inválido. Use 'credit_card' ou 'pix'.")
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


@router.get("/payment-methods")
def available_payment_methods():
    return default_saas_mp_service.checkout_capabilities()


@router.post("/{protocol}/billing/setup")
def setup_contract_billing(
    protocol: str,
    payload: SaasBillingSetupRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    from ..services.saas_checkout_lock import checkout_lock
    with checkout_lock(db, _normalize_protocol(protocol)):
        return _setup_contract_billing(protocol, payload, background_tasks, db)


def _setup_contract_billing(protocol, payload, background_tasks, db):
    """
    Configura o método de pagamento para o contrato assinado.
    Para cartão de crédito (Arquitetura B): cria o preapproval com 7 dias de trial no Mercado Pago
    e ativa atomicamente o tenant e sua assinatura no KÔMA.
    Para Pix: gera o pagamento Pix para plano anual.
    """
    if not default_saas_mp_service.checkout_capabilities().get(payload.payment_method_type):
        raise HTTPException(503, "Inscrição salva. Os pagamentos estão temporariamente indisponíveis; tente novamente mais tarde.")
    normalized_protocol = _normalize_protocol(protocol)
    acceptance = resolve_activation_acceptance(db, normalized_protocol)
    if acceptance is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Aceite contratual não encontrado para este protocolo.",
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
    payer_email = (payload.payer_email or str(acceptance.get("email") or "")).strip().lower()
    if not payer_email or "@" not in payer_email:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="E-mail do pagador inválido.",
        )

    renewal_reference = None
    existing = get_billing_setup(db, normalized_protocol)
    if existing and existing.status == "ready":
        provision_res = provision_restaurant_for_contract(db, acceptance=acceptance, billing_setup=existing, actor="saas_checkout", background_tasks=background_tasks)
        return {"success": True, "status": "ready", "restaurantId": str(provision_res["restaurant_id"]), "slug": provision_res["slug"], "trialDays": 7, "trialEndsAt": provision_res["trial_ends_at"].isoformat(), "activationToken": provision_res.get("invitation_token")}
    if existing and existing.status == "pending" and existing.payment_method_type == "credit_card":
        try:
            recovered = (default_saas_mp_service.get_preapproval(existing.provider_subscription_id)
                if existing.provider_subscription_id else default_saas_mp_service.find_preapproval(normalized_protocol, payer_email))
        except SaasMercadoPagoError as exc:
            raise HTTPException(502, "Ainda não foi possível confirmar a autorização anterior. Nenhuma nova cobrança foi criada.") from exc
        if not recovered or recovered.get("status") != "authorized":
            raise HTTPException(409, "A autorização anterior está em confirmação. Aguarde antes de tentar novamente.")
        recurring = recovered.get("auto_recurring") or {}
        if str(recovered.get("external_reference")) != normalized_protocol or _normalized_money(recurring.get("transaction_amount")) != _normalized_money(terms["commercial"]["billingAmount"]) or recurring.get("currency_id") != "BRL":
            raise HTTPException(409, "A autorização anterior precisa de revisão; os dados não correspondem ao contrato.")
        upsert_billing_setup(db, protocol=normalized_protocol, status="ready", payment_method_type="credit_card", provider_subscription_id=str(recovered["id"]), billing_cycle=canonical_cycle)
        db.commit()
        return _setup_contract_billing(protocol, payload, background_tasks, db)

    if existing and existing.status == "pending" and existing.provider_subscription_id:
        if existing.payment_method_type != payload.payment_method_type:
            raise HTTPException(409, "Já existe um pagamento pendente. Conclua essa tentativa antes de trocar o método.")
        if existing.payment_method_type == "pix":
            try:
                payment = default_saas_mp_service.get_payment(existing.provider_subscription_id)
            except SaasMercadoPagoError as exc:
                raise HTTPException(502, "Não foi possível recuperar o Pix. Tente novamente.") from exc
            if payment.get("status") in {"cancelled", "rejected"}:
                # A new key is safe only after the previous charge is terminal at the provider.
                renewal_reference = existing.provider_subscription_id
            else:
                transaction = (payment.get("point_of_interaction") or {}).get("transaction_data") or {}
                return {"success": True, "status": "pending", "paymentId": existing.provider_subscription_id, "qrCode": transaction.get("qr_code"), "qrCodeBase64": transaction.get("qr_code_base64"), "ticketUrl": transaction.get("ticket_url"), "expiresAt": payment.get("date_of_expiration")}

    # 1. Cartão de Crédito (Arquitetura B)
    if payload.payment_method_type == "credit_card":
        card_token_id = (payload.card_token_id or "").strip()
        if not card_token_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="card_token_id é obrigatório para pagamento com cartão de crédito.",
            )

        amount = Decimal(terms["commercial"]["billingAmount"])

        upsert_billing_setup(db, protocol=normalized_protocol, contract_acceptance_id=str(acceptance["acceptance_id"]), payment_method_type="credit_card", status="pending", billing_cycle=canonical_cycle)
        db.commit()
        try:
            mp_res = default_saas_mp_service.create_preapproval(
                protocol=normalized_protocol,
                plan=plan,
                billing_cycle=canonical_cycle,
                amount=amount,
                card_token_id=card_token_id,
                payer_email=payer_email,
                trial_days=7,
            )
        except SaasMercadoPagoError as exc:
            outcome = "failed" if exc.status_code is not None and 400 <= exc.status_code < 500 else "pending"
            upsert_billing_setup(db, protocol=normalized_protocol, payment_method_type="credit_card", status=outcome, billing_cycle=canonical_cycle)
            db.commit()
            logger.warning("Preapproval creation failed for %s", normalized_protocol)
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail=str(exc),
            ) from exc

        if str(mp_res.get("status") or "").lower() != "authorized" or not mp_res.get("id"):
            upsert_billing_setup(db, protocol=normalized_protocol, payment_method_type="credit_card", status="pending", provider_subscription_id=str(mp_res["id"]) if mp_res.get("id") else None, billing_cycle=canonical_cycle)
            db.commit()
            raise HTTPException(402, "O provedor ainda não autorizou a assinatura. Aguarde a confirmação para tentar novamente.")
        sub_id = str(mp_res.get("id") or "")
        payer_id = str(mp_res.get("payer_id") or "")

        upsert_billing_setup(
            db,
            protocol=normalized_protocol,
            contract_acceptance_id=str(acceptance.get("acceptance_id")),
            provider="mercado_pago",
            payment_method_type="credit_card",
            status="ready",
            provider_customer_id=payer_id,
            provider_subscription_id=sub_id,
            billing_cycle=canonical_cycle,
        )
        db.commit()

        # Ativação imediata do tenant (Arquitetura B)
        billing_setup = get_billing_setup(db, normalized_protocol)
        provision_res = provision_restaurant_for_contract(
            db,
            acceptance=acceptance,
            billing_setup=billing_setup,
            actor="saas_checkout",
            reason="Ativação imediata pós-autorização de cartão no checkout com 7 dias grátis",
            background_tasks=background_tasks,
        )

        return {
            "success": True,
            "status": "ready",
            "restaurantId": str(provision_res["restaurant_id"]),
            "slug": provision_res["slug"],
            "trialDays": 7,
            "trialEndsAt": provision_res["trial_ends_at"].isoformat(),
            "activationToken": provision_res.get("invitation_token"),
            "message": "Assinatura autorizada com sucesso! Seu período de 7 dias grátis já começou.",
        }

    # 2. Pix (Exclusivo para ciclo Anual)
    if payload.payment_method_type == "pix":
        if not is_annual:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="O pagamento via Pix está disponível exclusivamente para o plano anual com pagamento antecipado.",
            )

        amount = Decimal(terms["commercial"]["billingAmount"])
        payer_name = str(acceptance.get("representative_name") or acceptance.get("contracting_party_name") or "Cliente")
        payer_tax_id = str(terms["representative"]["taxId"])

        try:
            pix_res = default_saas_mp_service.create_annual_pix(
                protocol=normalized_protocol,
                plan=plan,
                amount=amount,
                payer_email=payer_email,
                payer_name=payer_name,
                payer_tax_id=payer_tax_id,
                attempt_reference=renewal_reference,
            )
        except SaasMercadoPagoError as exc:
            logger.warning("Pix creation failed for %s: %s", normalized_protocol, exc)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=str(exc),
            ) from exc

        payment_id = str(pix_res.get("id") or "")
        upsert_billing_setup(
            db,
            protocol=normalized_protocol,
            contract_acceptance_id=str(acceptance.get("acceptance_id")),
            provider="mercado_pago",
            payment_method_type="pix",
            status="pending",
            provider_payment_method_reference=payment_id,
            provider_subscription_id=payment_id,
            billing_cycle="annual",
        )
        db.commit()

        return {
            "success": True,
            "status": "pending",
            "paymentMethodType": "pix",
            "paymentId": payment_id,
            "qrCode": pix_res.get("qr_code"),
            "qrCodeBase64": pix_res.get("qr_code_base64"),
            "ticketUrl": pix_res.get("ticket_url"),
            "expiresAt": pix_res.get("expires_at"),
            "message": "Pix gerado com sucesso. Seu restaurante será ativado automaticamente assim que o pagamento for aprovado.",
        }


@router.get("/{protocol}/billing/status")
def get_contract_billing_status(
    protocol: str,
    db: Session = Depends(get_db),
):
    """Consulta o status da configuração de billing de uma contratação."""
    normalized_protocol = _normalize_protocol(protocol)
    acceptance = resolve_activation_acceptance(db, normalized_protocol)
    if acceptance is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Aceite contratual não encontrado para este protocolo.",
        )

    billing = get_billing_setup(db, normalized_protocol)
    linked_tenant_id = acceptance.get("linked_restaurante_id")
    restaurant_slug = None
    if linked_tenant_id is not None:
        with tenant_session_scope(db, linked_tenant_id):
            restaurant = db.query(Restaurante).filter(Restaurante.id == linked_tenant_id).one_or_none()
            restaurant_slug = str(restaurant.slug) if restaurant and restaurant.slug else None

    return {
        "protocol": normalized_protocol,
        "billingStatus": billing.status if billing else "pending",
        "provider": billing.provider if billing else None,
        "paymentMethodType": billing.payment_method_type if billing else None,
        "isActivated": linked_tenant_id is not None,
        "restaurantId": str(linked_tenant_id) if linked_tenant_id else None,
        "slug": restaurant_slug,
    }


@webhook_router.post("/webhook")
async def mercado_pago_saas_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    x_signature: str | None = Header(default=None),
    x_request_id: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """
    Webhook dedicado para notificações de assinaturas e cobrança SaaS do KÔMA.
    Reconcilia status de preapprovals e pagamentos Pix em saas_subscriptions e saas_billing_setups.
    O evento de pagamento é apenas um gatilho: a ativação só ocorre depois de consultar
    o pagamento diretamente no Mercado Pago e confirmar status, referência, método e valor.
    """
    try:
        payload = await request.json()
    except Exception:
        payload = {}

    if not isinstance(payload, dict) or not isinstance(payload.get("data", {}), dict):
        raise HTTPException(400, "Notificação inválida.")
    data = payload.get("data") or {}
    data_id = str(data.get("id") or payload.get("id") or "").strip()
    event_type = str(payload.get("type") or payload.get("action") or "").strip().lower()

    if not default_saas_mp_service.verify_webhook_signature(
        signature_header=x_signature or "",
        request_id=x_request_id or "",
        data_id=data_id,
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Assinatura de webhook do Mercado Pago inválida.",
        )

    logger.info("SaaS Mercado Pago webhook received event=%s data_id=%s", event_type, data_id)

    if event_type == "subscription_authorized_payment":
        from ..services.saas_invoice_reconciliation import reconcile_invoice
        return reconcile_invoice(db, data_id)

    # 1. Evento de Assinatura Recorrente (Preapproval)
    if "preapproval" in event_type or payload.get("entity") == "preapproval":
        sub_id = data_id
        if sub_id:
            billing = get_billing_setup_by_provider_sub(db, "mercado_pago", sub_id)
            if billing is None:
                try:
                    mandate = default_saas_mp_service.get_preapproval(sub_id)
                except SaasMercadoPagoError as exc:
                    raise HTTPException(502, "Não foi possível recuperar a autorização.") from exc
                reference = str(mandate.get("external_reference") or "")
                if _PROTOCOL_RE.fullmatch(reference):
                    pending = get_billing_setup(db, reference)
                    if pending and pending.status == "pending" and pending.payment_method_type == "credit_card" and not pending.provider_subscription_id:
                        upsert_billing_setup(db, protocol=reference, status="pending", provider_subscription_id=sub_id, billing_cycle=pending.billing_cycle)
                        db.commit()
                        billing = get_billing_setup(db, reference)
                    elif pending is None:
                        raise HTTPException(503, "Autorização ainda não associada. Reenvie a notificação.")
            if billing and not billing.restaurante_id:
                from ..services.saas_checkout_lock import checkout_lock
                with checkout_lock(db, billing.protocol):
                    _setup_contract_billing(billing.protocol, SaasBillingSetupRequest(payment_method_type="credit_card"), background_tasks, db)
            if billing and billing.restaurante_id:
                with tenant_session_scope(db, billing.restaurante_id):
                    saas_sub = db.query(SaaSSubscription).filter(SaaSSubscription.restaurante_id == billing.restaurante_id).one_or_none()
                    if saas_sub:
                        try:
                            mp_data = default_saas_mp_service.get_preapproval(sub_id)
                        except SaasMercadoPagoError as exc:
                            raise HTTPException(502, "Não foi possível consultar a assinatura.") from exc
                        mp_status = str(mp_data.get("status") or "").lower()
                        if mp_status == "paused": saas_sub.status = "suspended"
                        elif mp_status == "cancelled": saas_sub.status = "canceled"
                        # authorized confirms a mandate, never a paid invoice.
                        saas_sub.updated_at = datetime.datetime.now(datetime.timezone.utc)
                        db.commit()

    # 2. Evento de Pagamento (ex.: Pix Anual aprovado)
    elif "payment" in event_type:
        payment_id = data_id
        if payment_id:
            billing = get_billing_setup_by_provider_sub(db, "mercado_pago", payment_id)
            if billing is None:
                raise HTTPException(503, "Pagamento ainda não associado. Reenvie a notificação.")
            if billing and billing.status in {"pending", "ready"}:
                if billing.payment_method_type != "pix" or billing.billing_cycle not in ("annual", "anual"):
                    logger.warning(
                        "Ignoring payment webhook for incompatible billing setup protocol=%s method=%s cycle=%s",
                        billing.protocol,
                        billing.payment_method_type,
                        billing.billing_cycle,
                    )
                    return {"status": "received", "activated": False, "reason": "incompatible_billing_setup"}

                try:
                    provider_payment = default_saas_mp_service.get_payment(payment_id)
                except SaasMercadoPagoError as exc:
                    logger.warning("Could not verify Mercado Pago payment %s: %s", payment_id, exc)
                    raise HTTPException(
                        status_code=status.HTTP_502_BAD_GATEWAY,
                        detail="Não foi possível confirmar o pagamento junto ao gateway.",
                    ) from exc

                provider_status = str(provider_payment.get("status") or "").strip().lower()
                if provider_status != "approved":
                    logger.info(
                        "Payment %s not approved yet (status=%s); tenant remains pending",
                        payment_id,
                        provider_status or "unknown",
                    )
                    return {
                        "status": "received",
                        "activated": False,
                        "paymentStatus": provider_status or "unknown",
                    }

                provider_method = str(provider_payment.get("payment_method_id") or "").strip().lower()
                if provider_method != "pix":
                    logger.warning("Ignoring payment %s because provider method is %s", payment_id, provider_method or "unknown")
                    return {"status": "received", "activated": False, "reason": "payment_method_mismatch"}

                provider_reference = str(provider_payment.get("external_reference") or "").strip().upper()
                if provider_reference != billing.protocol:
                    logger.warning(
                        "Ignoring payment %s due external reference mismatch expected=%s got=%s",
                        payment_id,
                        billing.protocol,
                        provider_reference or "empty",
                    )
                    return {"status": "received", "activated": False, "reason": "external_reference_mismatch"}

                acceptance = resolve_activation_acceptance(db, billing.protocol)
                if acceptance is None:
                    logger.warning("Billing acceptance disappeared before Pix activation protocol=%s", billing.protocol)
                    return {"status": "received", "activated": False, "reason": "acceptance_not_found"}

                plan = str(acceptance.get("plan") or "pro").lower()
                expected_amount = _normalized_money(contract_billing_terms(db, billing.protocol)["commercial"]["billingAmount"])
                provider_amount = _normalized_money(provider_payment.get("transaction_amount"))
                if provider_amount is None or expected_amount is None or provider_amount != expected_amount:
                    logger.warning(
                        "Ignoring payment %s due amount mismatch expected=%s got=%s",
                        payment_id,
                        expected_amount,
                        provider_amount,
                    )
                    return {"status": "received", "activated": False, "reason": "amount_mismatch"}

                upsert_billing_setup(
                    db,
                    protocol=billing.protocol,
                    contract_acceptance_id=billing.contract_acceptance_id,
                    provider=billing.provider,
                    payment_method_type=billing.payment_method_type,
                    status="ready",
                    provider_customer_id=billing.provider_customer_id,
                    provider_payment_method_reference=billing.provider_payment_method_reference,
                    provider_subscription_id=billing.provider_subscription_id,
                    billing_cycle=billing.billing_cycle,
                )
                db.commit()

                if not billing.restaurante_id:
                    billing_setup_data = get_billing_setup(db, billing.protocol)
                    provision_restaurant_for_contract(
                        db,
                        acceptance=acceptance,
                        billing_setup=billing_setup_data,
                        actor="saas_webhook",
                        reason="Ativação automática pós-confirmação verificada de pagamento Pix anual via Mercado Pago",
                        background_tasks=background_tasks,
                    )
                    logger.info("Tenant activated via verified Pix approval for protocol %s", billing.protocol)

                return {"status": "received", "activated": True, "paymentStatus": provider_status}

    return {"status": "received"}
