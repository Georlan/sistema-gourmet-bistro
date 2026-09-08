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
from ..database import SessionLocal, get_db
from ..models import Restaurante
from ..saas_billing_models import SaaSSubscription
from ..services.billing_service import (
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


@router.post("/{protocol}/billing/setup")
def setup_contract_billing(
    protocol: str,
    payload: SaasBillingSetupRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """
    Configura o método de pagamento para o contrato assinado.
    Para cartão de crédito (Arquitetura B): cria o preapproval com 7 dias de trial no Mercado Pago
    e ativa atomicamente o tenant e sua assinatura no KÔMA.
    Para Pix: gera o pagamento Pix para plano anual.
    """
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

    payer_email = (payload.payer_email or str(acceptance.get("email") or "")).strip().lower()
    if not payer_email or "@" not in payer_email:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="E-mail do pagador inválido.",
        )

    # 1. Cartão de Crédito (Arquitetura B)
    if payload.payment_method_type == "credit_card":
        card_token_id = (payload.card_token_id or "").strip()
        if not card_token_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="card_token_id é obrigatório para pagamento com cartão de crédito.",
            )

        amount = subscription_annual_total(plan) if is_annual else subscription_monthly_price(plan)

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
            logger.warning("Preapproval creation failed for %s: %s", normalized_protocol, exc)
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail=str(exc),
            ) from exc

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
            "message": "Assinatura autorizada com sucesso! Seu período de 7 dias grátis já começou.",
        }

    # 2. Pix (Exclusivo para ciclo Anual)
    if payload.payment_method_type == "pix":
        if not is_annual:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="O pagamento via Pix está disponível exclusivamente para o plano anual com pagamento antecipado.",
            )

        amount = subscription_annual_total(plan)
        payer_name = str(acceptance.get("representative_name") or acceptance.get("contracting_party_name") or "Cliente")
        payer_tax_id = str(acceptance.get("representative_tax_id") or acceptance.get("contracting_party_tax_id") or "")

        try:
            pix_res = default_saas_mp_service.create_annual_pix(
                protocol=normalized_protocol,
                plan=plan,
                amount=amount,
                payer_email=payer_email,
                payer_name=payer_name,
                payer_tax_id=payer_tax_id,
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

    # 1. Evento de Assinatura Recorrente (Preapproval)
    if "preapproval" in event_type or payload.get("entity") == "preapproval":
        sub_id = data_id
        if sub_id:
            billing = get_billing_setup_by_provider_sub(db, "mercado_pago", sub_id)
            if billing and billing.restaurante_id:
                now = datetime.datetime.now(datetime.timezone.utc)
                saas_sub = db.query(SaaSSubscription).filter(
                    SaaSSubscription.restaurante_id == billing.restaurante_id
                ).one_or_none()

                if saas_sub:
                    try:
                        mp_data = default_saas_mp_service.get_preapproval(sub_id)
                        mp_status = str(mp_data.get("status") or "").lower()

                        if mp_status == "authorized":
                            # Verifica se ainda está no período de trial
                            if saas_sub.trial_ends_at and now <= saas_sub.trial_ends_at:
                                saas_sub.status = "trialing"
                            else:
                                saas_sub.status = "active"
                                saas_sub.grace_until = None
                        elif mp_status == "paused":
                            saas_sub.status = "suspended"
                        elif mp_status == "cancelled":
                            saas_sub.status = "canceled"
                        elif mp_status == "pending":
                            saas_sub.status = "past_due"
                            if not saas_sub.grace_until:
                                saas_sub.grace_until = now + datetime.timedelta(days=3)

                        saas_sub.updated_at = now
                        db.commit()
                        logger.info(
                            "Updated SaaS subscription status to %s for tenant %s via webhook",
                            saas_sub.status, billing.restaurante_id
                        )
                    except Exception as exc:
                        logger.error("Error processing preapproval webhook %s: %s", sub_id, exc)

    # 2. Evento de Pagamento (ex.: Pix Anual aprovado)
    elif "payment" in event_type:
        payment_id = data_id
        if payment_id:
            billing = get_billing_setup_by_provider_sub(db, "mercado_pago", payment_id)
            if billing and billing.status == "pending":
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
                expected_amount = _normalized_money(subscription_annual_total(plan))
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
