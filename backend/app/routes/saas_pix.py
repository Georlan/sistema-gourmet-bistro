from __future__ import annotations

import calendar
import datetime as dt
import os
import re
import uuid
from decimal import Decimal, InvalidOperation
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db, tenant_session_scope
from ..models import Restaurante
from ..saas_billing_models import SaaSSubscription
from ..security import get_current_user
from ..services.billing_service import (
    contract_billing_terms,
    contract_fixed_billing_required,
    get_billing_setup,
    tenant_commercial_terms,
    upsert_billing_setup,
)
from ..services.restaurant_provisioning import provision_restaurant_for_contract, resolve_activation_acceptance
from ..services.saas_billing_policy import SAAS_TRIAL_DAYS
from ..services.saas_mercadopago import SaasMercadoPagoError, default_saas_mp_service
from ..services.signup_notifications import enqueue_release_required
from ..subscription import legacy_v25_annual_total, legacy_v25_monthly_price


contract_router = APIRouter(prefix="/api/contracts", tags=["SaaS Pix"])
subscription_router = APIRouter(prefix="/api/subscription", tags=["Assinatura Pix"])
webhook_router = APIRouter(prefix="/api/integrations/saas-pix/mercado-pago", tags=["SaaS Pix Webhook"])

_PROTOCOL_RE = re.compile(r"^KOMA-CTR-\d{8}-[A-F0-9]{12}$")
_PIX_REFERENCE_RE = re.compile(r"^KOMA-SAAS-PIX-(\d+)-(\d{8})$")
_MONEY_QUANTUM = Decimal("0.01")
_PIX_EXPIRATION_HOURS = 24


def _env_flag(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _normalize_protocol(protocol: str) -> str:
    normalized = protocol.strip().upper()
    if not _PROTOCOL_RE.fullmatch(normalized):
        raise HTTPException(status_code=422, detail="Protocolo contratual inválido.")
    return normalized


def _as_utc(value: dt.datetime | None) -> dt.datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=dt.timezone.utc)
    return value.astimezone(dt.timezone.utc)


def _parse_provider_datetime(value: object) -> dt.datetime | None:
    if not value:
        return None
    try:
        parsed = dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return _as_utc(parsed)


def _normalized_money(value: object) -> Decimal | None:
    try:
        result = Decimal(str(value)).quantize(_MONEY_QUANTUM)
    except (InvalidOperation, TypeError, ValueError):
        return None
    return result if result.is_finite() else None


def _pix_available() -> tuple[bool, dict[str, Any]]:
    capabilities = dict(default_saas_mp_service.checkout_capabilities())
    provider_ready = capabilities.get("providerAuthReady") is not False
    checkout_enabled = default_saas_mp_service.mock_allowed or _env_flag("KOMA_SAAS_CHECKOUT_ENABLED")
    webhook_ready = default_saas_mp_service.mock_allowed or bool(settings.KOMA_SAAS_MERCADO_PAGO_WEBHOOK_SECRET)
    return bool(provider_ready and checkout_enabled and webhook_ready), capabilities


def _checkout_methods_payload() -> dict[str, Any]:
    pix_ready, capabilities = _pix_available()
    return {
        "credit_card": bool(capabilities.get("credit_card")),
        "pix": pix_ready,
        "account_money": bool(capabilities.get("account_money")),
        "publicKey": str(capabilities.get("publicKey") or ""),
        "providerAuthReady": capabilities.get("providerAuthReady"),
        "providerAuthReason": capabilities.get("providerAuthReason"),
        "environment": capabilities.get("environment"),
        "isTestMode": bool(capabilities.get("isTestMode")),
        "trialDays": SAAS_TRIAL_DAYS,
        "upfrontPaymentAllowed": False,
        "pixMode": "universal_qr",
        "pixInteroperable": True,
        "pixAutomatic": False,
    }


@contract_router.get("/payment-methods-v2")
def available_checkout_methods():
    """Expõe somente os três meios canônicos do checkout SaaS."""
    return _checkout_methods_payload()


@contract_router.post("/{protocol}/billing/pix/select")
def select_contract_pix(protocol: str, db: Session = Depends(get_db)):
    """Seleciona Pix universal sem criar cobrança durante onboarding/trial."""
    pix_ready, _ = _pix_available()
    if not pix_ready:
        raise HTTPException(503, "Pix está temporariamente indisponível; sua inscrição continua salva.")

    normalized_protocol = _normalize_protocol(protocol)
    acceptance = resolve_activation_acceptance(db, normalized_protocol)
    if acceptance is None:
        raise HTTPException(404, "Aceite contratual não encontrado para este protocolo.")
    if acceptance.get("plan_change_restaurante_id") is not None:
        raise HTTPException(
            409,
            "Este protocolo pertence a uma mudança de plano e não pode usar o Pix da contratação inicial.",
        )
    if not contract_fixed_billing_required(db, normalized_protocol):
        raise HTTPException(
            409,
            "Este contrato não possui mensalidade fixa. Use a ativação gratuita; nenhum Pix de assinatura é necessário.",
        )

    existing_tenant_id = acceptance.get("linked_restaurante_id")
    if existing_tenant_id is not None:
        return {
            "success": True,
            "status": "already_activated",
            "restaurantId": str(existing_tenant_id),
            "message": "Este contrato já foi ativado previamente.",
        }

    raw_cycle = str(acceptance.get("billing_cycle") or "mensal").strip().lower()
    canonical_cycle = "annual" if raw_cycle in {"annual", "anual"} else "monthly"
    existing = get_billing_setup(db, normalized_protocol)
    if existing and existing.status in {"pending", "ready"} and existing.payment_method_type != "pix":
        raise HTTPException(409, "Já existe outro meio financeiro em andamento. Cancele-o antes de selecionar Pix.")

    upsert_billing_setup(
        db,
        protocol=normalized_protocol,
        contract_acceptance_id=str(acceptance["acceptance_id"]),
        provider="mercado_pago",
        payment_method_type="pix",
        status="ready",
        provider_customer_id=None,
        provider_payment_method_reference=None,
        provider_subscription_id=None,
        billing_cycle=canonical_cycle,
    )
    db.commit()
    billing = get_billing_setup(db, normalized_protocol)
    if billing is None:
        raise HTTPException(500, "Não foi possível persistir a escolha do Pix.")

    plan = str(acceptance.get("plan") or "pro").strip().lower()
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
            "paymentMethodType": "pix",
            "amountDueToday": 0,
            "trialDays": SAAS_TRIAL_DAYS,
            "message": (
                "Pix anual selecionado. Nenhum valor é cobrado hoje; depois da implantação e dos 7 dias grátis, "
                "um único QR do valor anual será gerado e quitará os próximos 12 meses."
                if canonical_cycle == "annual"
                else "Pix mensal selecionado. Nenhum valor é cobrado hoje; depois da implantação e dos 7 dias grátis, "
                "o QR da primeira mensalidade será gerado no vencimento."
            ),
        }

    provisioned = provision_restaurant_for_contract(
        db,
        acceptance=acceptance,
        billing_setup=billing,
        actor="saas_checkout",
    )
    return {
        "success": True,
        "status": "ready",
        "paymentMethodType": "pix",
        "restaurantId": str(provisioned["restaurant_id"]),
        "slug": provisioned.get("slug"),
        "trialDays": SAAS_TRIAL_DAYS,
        "trialStartsAfterSetup": True,
        "trialEndsAt": None,
        "activationToken": provisioned.get("invitation_token"),
        "amountDueToday": 0,
        "message": "Pix selecionado. O trial começa somente quando o restaurante iniciar explicitamente a operação após concluir a configuração, e nenhum QR de cobrança é criado antes do vencimento.",
    }


def _administrator(user=Depends(get_current_user)):
    if str(user.cargo or "").lower() not in {"admin", "superadmin"}:
        raise HTTPException(403, "Somente o administrador pode gerenciar a assinatura.")
    return user


def _subscription_amount(db: Session, subscription: SaaSSubscription, restaurante_id: int) -> Decimal:
    """Resolve valor do Pix SaaS pelo contrato do tenant, nunca pelo catálogo atual."""
    restaurant = db.query(Restaurante).filter(Restaurante.id == restaurante_id).one_or_none()
    if restaurant is None:
        raise HTTPException(404, "Restaurante não encontrado.")

    try:
        terms = tenant_commercial_terms(db, restaurante_id)
    except RuntimeError as exc:
        raise HTTPException(
            409,
            "Os termos comerciais contratados estão indisponíveis para gerar a cobrança.",
        ) from exc
    if terms is not None:
        return terms.billing_amount.quantize(_MONEY_QUANTUM)

    if str(getattr(restaurant, "billing_mode", "") or "").strip().lower() != "legacy":
        raise HTTPException(
            409,
            "Tenant de assinatura sem aceite comercial vinculado; "
            "a cobrança não pode usar preço legado.",
        )

    cycle = str(subscription.billing_cycle or "monthly").strip().lower()
    if cycle in {"annual", "anual"}:
        return legacy_v25_annual_total(restaurant.plano)
    return legacy_v25_monthly_price(restaurant.plano)


def _pix_reference(restaurante_id: int, due_at: dt.datetime) -> str:
    return f"KOMA-SAAS-PIX-{restaurante_id}-{due_at.astimezone(dt.timezone.utc):%Y%m%d}"


def _payment_qr_payload(payment: dict[str, Any], *, due_at: dt.datetime | None, amount: Decimal) -> dict[str, Any]:
    transaction = ((payment.get("point_of_interaction") or {}).get("transaction_data") or {})
    return {
        "status": str(payment.get("status") or "pending").lower(),
        "paymentId": str(payment.get("id") or "") or None,
        "amount": str(amount.quantize(_MONEY_QUANTUM)),
        "dueAt": due_at.isoformat() if due_at else None,
        "qrCode": transaction.get("qr_code"),
        "qrCodeBase64": transaction.get("qr_code_base64"),
        "ticketUrl": transaction.get("ticket_url"),
        "expiresAt": payment.get("date_of_expiration"),
        "paymentMethodType": "pix",
        "automaticRenewal": False,
    }


def _create_pix_payment(*, restaurante_id: int, amount: Decimal, payer_email: str, due_at: dt.datetime) -> dict[str, Any]:
    service = default_saas_mp_service
    service._ensure_provider_ready()
    reference = _pix_reference(restaurante_id, due_at)
    now = dt.datetime.now(dt.timezone.utc)
    expiration = now + dt.timedelta(hours=_PIX_EXPIRATION_HOURS)

    if service.is_mock:
        return {
            "id": f"mock-pix-{restaurante_id}-{now:%Y%m%d%H%M}",
            "status": "pending",
            "payment_method_id": "pix",
            "external_reference": reference,
            "transaction_amount": float(amount),
            "currency_id": "BRL",
            "date_of_expiration": expiration.isoformat(),
            "point_of_interaction": {
                "transaction_data": {
                    "qr_code": f"000201-KOMA-SAAS-{restaurante_id}-{amount}",
                    "qr_code_base64": "",
                    "ticket_url": None,
                }
            },
        }

    notification_url = ""
    if settings.KOMA_PUBLIC_API_URL:
        notification_url = f"{settings.KOMA_PUBLIC_API_URL}/api/integrations/saas-pix/mercado-pago/webhook"
    payload: dict[str, Any] = {
        "transaction_amount": float(amount),
        "description": "Mensalidade KÔMA",
        "payment_method_id": "pix",
        "external_reference": reference,
        "date_of_expiration": expiration.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        "payer": {"email": payer_email},
    }
    if notification_url:
        payload["notification_url"] = notification_url

    key_source = f"https://komafood.com.br/saas-pix/{restaurante_id}/{due_at.date().isoformat()}/{now:%Y%m%d}"
    idempotency_key = str(uuid.uuid5(uuid.NAMESPACE_URL, key_source))
    try:
        with service._client() as client:
            response = client.post(
                "/v1/payments",
                json=payload,
                headers={"X-Idempotency-Key": idempotency_key},
            )
            if response.status_code >= 400:
                data = response.json() if response.headers.get("content-type", "").startswith("application/json") else {}
                detail = data.get("message") or data.get("error") or response.text
                raise SaasMercadoPagoError(f"Falha ao gerar o Pix: {detail}", status_code=response.status_code)
            result = response.json()
            service._validate_merchant_identity(result)
            if not result.get("id"):
                raise SaasMercadoPagoError("O gateway não retornou o identificador do Pix.", status_code=502)
            return result
    except SaasMercadoPagoError:
        raise
    except Exception as exc:
        raise SaasMercadoPagoError("Erro de comunicação ao gerar o Pix.") from exc


def _advance_paid_period(subscription: SaaSSubscription, paid_at: dt.datetime) -> None:
    months = 12 if str(subscription.billing_cycle or "").lower() in {"annual", "anual"} else 1
    month_index = paid_at.year * 12 + paid_at.month - 1 + months
    year, month_zero = divmod(month_index, 12)
    month = month_zero + 1
    end = paid_at.replace(year=year, month=month, day=min(paid_at.day, calendar.monthrange(year, month)[1]))
    current_end = _as_utc(subscription.current_period_end)
    if current_end is None or end > current_end:
        subscription.current_period_start = paid_at
        subscription.current_period_end = end
    if subscription.status not in {"canceled", "suspended"}:
        subscription.status = "active"
    subscription.grace_until = None
    subscription.updated_at = dt.datetime.now(dt.timezone.utc)


def _reconcile_pix_payment(db: Session, subscription: SaaSSubscription, payment: dict[str, Any], *, restaurante_id: int) -> bool:
    if str(payment.get("status") or "").lower() != "approved":
        return False
    if str(payment.get("payment_method_id") or "").lower() != "pix":
        return False
    if str(payment.get("currency_id") or "BRL").upper() != "BRL":
        return False
    due_at = _as_utc(subscription.current_period_end) or _as_utc(subscription.trial_ends_at)
    if due_at is None:
        return False
    if str(payment.get("external_reference") or "") != _pix_reference(restaurante_id, due_at):
        return False
    expected = _subscription_amount(db, subscription, restaurante_id)
    if _normalized_money(payment.get("transaction_amount")) != expected.quantize(_MONEY_QUANTUM):
        return False
    paid_at = _parse_provider_datetime(payment.get("date_approved"))
    if paid_at is None:
        return False
    _advance_paid_period(subscription, paid_at)
    db.commit()
    return True


@subscription_router.post("/pix")
def generate_or_get_subscription_pix(user=Depends(_administrator), db: Session = Depends(get_db)):
    restaurante_id = int(user.restaurante_id)
    subscription = (
        db.query(SaaSSubscription)
        .filter(SaaSSubscription.restaurante_id == restaurante_id)
        .with_for_update()
        .one_or_none()
    )
    if subscription is None:
        raise HTTPException(404, "Assinatura não encontrada.")
    if str(subscription.payment_method_type or "").lower() != "pix":
        raise HTTPException(409, "Esta assinatura não utiliza Pix.")

    now = dt.datetime.now(dt.timezone.utc)
    due_at = _as_utc(subscription.current_period_end) or _as_utc(subscription.trial_ends_at)
    if subscription.trial_started_at is None:
        return {
            "status": "not_due",
            "paymentMethodType": "pix",
            "trialStartsAfterSetup": True,
            "dueAt": None,
            "automaticRenewal": False,
            "message": "O Pix só será gerado depois da implantação essencial e dos 7 dias grátis.",
        }
    if due_at is not None and now < due_at:
        return {
            "status": "not_due",
            "paymentMethodType": "pix",
            "trialStartsAfterSetup": False,
            "dueAt": due_at.isoformat(),
            "automaticRenewal": False,
            "message": "Ainda não há cobrança Pix vencida.",
        }

    amount = _subscription_amount(db, subscription, restaurante_id)
    existing_payment_id = str(subscription.provider_subscription_id or "").strip()
    if existing_payment_id:
        try:
            existing_payment = default_saas_mp_service.get_payment(existing_payment_id)
        except SaasMercadoPagoError:
            existing_payment = None
        if existing_payment:
            if _reconcile_pix_payment(db, subscription, existing_payment, restaurante_id=restaurante_id):
                return {
                    **_payment_qr_payload(existing_payment, due_at=due_at, amount=amount),
                    "status": "approved",
                    "paidUntil": _as_utc(subscription.current_period_end).isoformat() if subscription.current_period_end else None,
                }
            provider_status = str(existing_payment.get("status") or "").lower()
            expires_at = _parse_provider_datetime(existing_payment.get("date_of_expiration"))
            if provider_status in {"pending", "in_process"} and (expires_at is None or now < expires_at):
                return _payment_qr_payload(existing_payment, due_at=due_at, amount=amount)

    payer_email = str(getattr(user, "email", "") or "").strip().lower()
    if not payer_email or "@" not in payer_email:
        raise HTTPException(422, "O administrador precisa ter um e-mail válido para gerar o Pix.")
    try:
        payment = _create_pix_payment(
            restaurante_id=restaurante_id,
            amount=amount,
            payer_email=payer_email,
            due_at=due_at or now,
        )
    except SaasMercadoPagoError as exc:
        raise HTTPException(502, str(exc)) from exc

    subscription.provider_subscription_id = str(payment["id"])
    subscription.updated_at = now
    db.commit()
    return _payment_qr_payload(payment, due_at=due_at, amount=amount)


@webhook_router.post("/webhook")
async def mercado_pago_saas_pix_webhook(
    request: Request,
    x_signature: str | None = Header(default=None),
    x_request_id: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    raw_data = payload.get("data") if isinstance(payload, dict) else None
    data = raw_data if isinstance(raw_data, dict) else {}
    payment_id = str(
        request.query_params.get("data.id")
        or request.query_params.get("id")
        or data.get("id")
        or payload.get("id")
        or ""
    ).strip()
    if not payment_id:
        raise HTTPException(400, "Notificação inválida.")

    signature_header = (x_signature or request.headers.get("x-signature") or "").strip()
    request_id = (x_request_id or request.headers.get("x-request-id") or "").strip()
    if not default_saas_mp_service.verify_webhook_signature(
        signature_header=signature_header,
        request_id=request_id,
        data_id=payment_id,
    ):
        raise HTTPException(401, "Assinatura de webhook do Mercado Pago inválida.")

    try:
        payment = default_saas_mp_service.get_payment(payment_id)
    except SaasMercadoPagoError as exc:
        if exc.status_code in {400, 404}:
            return {"status": "received", "reconciled": False, "reason": "payment_not_found"}
        raise HTTPException(502, "Não foi possível confirmar o Pix.") from exc

    reference = str(payment.get("external_reference") or "").strip().upper()
    match = _PIX_REFERENCE_RE.fullmatch(reference)
    if not match:
        return {"status": "received", "reconciled": False, "reason": "foreign_payment"}
    restaurante_id = int(match.group(1))

    with tenant_session_scope(db, restaurante_id):
        subscription = (
            db.query(SaaSSubscription)
            .filter(SaaSSubscription.restaurante_id == restaurante_id)
            .with_for_update()
            .one_or_none()
        )
        if subscription is None or str(subscription.payment_method_type or "").lower() != "pix":
            return {"status": "received", "reconciled": False, "reason": "subscription_not_found"}
        if subscription.provider_subscription_id and str(subscription.provider_subscription_id) != payment_id:
            return {"status": "received", "reconciled": False, "reason": "stale_payment"}
        reconciled = _reconcile_pix_payment(db, subscription, payment, restaurante_id=restaurante_id)
        return {"status": "received", "reconciled": reconciled}
