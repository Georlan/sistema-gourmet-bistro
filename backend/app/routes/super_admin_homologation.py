from __future__ import annotations

import os

from fastapi import APIRouter, Depends, Request

from ..config import settings
from .super_admin import get_current_admin


router = APIRouter(prefix="/homologation", tags=["SuperAdmin"])
_HOMOLOGATION_ENVIRONMENTS = {"homologation", "homolog", "staging", "development", "test"}


def _env_flag(name: str, *, default: bool = False) -> bool:
    fallback = "true" if default else "false"
    return os.getenv(name, fallback).strip().lower() == "true"


def _check(
    check_id: str,
    label: str,
    ready: bool,
    detail: str,
    *,
    scope: str,
) -> dict[str, object]:
    return {
        "id": check_id,
        "label": label,
        "ready": ready,
        "detail": detail,
        "scope": scope,
    }


def _public_app_matches_environment(public_app_url: str, is_homologation: bool) -> bool:
    if not public_app_url:
        return False
    if not is_homologation:
        return True
    normalized = public_app_url.lower()
    return any(marker in normalized for marker in ("homolog", "staging", "localhost", "127.0.0.1"))


@router.get("/readiness")
def get_homologation_readiness(
    request: Request,
    admin=Depends(get_current_admin),
) -> dict[str, object]:
    """Return non-sensitive operational readiness for manual SaaS homologation."""
    environment = os.getenv("ENVIRONMENT", "production").strip().lower() or "production"
    is_homologation = environment in _HOMOLOGATION_ENVIRONMENTS

    access_token = settings.KOMA_SAAS_MERCADO_PAGO_ACCESS_TOKEN.strip()
    public_key = settings.KOMA_SAAS_MERCADO_PAGO_PUBLIC_KEY.strip()
    webhook_secret = settings.KOMA_SAAS_MERCADO_PAGO_WEBHOOK_SECRET.strip()
    public_app_url = settings.KOMA_PUBLIC_APP_URL.strip().rstrip("/")
    configured_api_url = settings.KOMA_PUBLIC_API_URL.strip().rstrip("/")
    request_api_url = str(request.base_url).rstrip("/")
    public_api_url = configured_api_url or request_api_url
    webhook_url = f"{public_api_url}/api/integrations/saas-billing/mercado-pago/webhook"

    checkout_enabled = _env_flag("KOMA_SAAS_CHECKOUT_ENABLED")
    outbox_worker_enabled = _env_flag("ENABLE_OUTBOX_WORKER", default=True) and environment != "test"
    test_credentials_ready = bool(access_token) and (
        access_token.startswith("TEST-") if is_homologation else not access_token.startswith("TEST-")
    )
    email_ready = bool(settings.RESEND_API_KEY.strip() and settings.EMAIL_FROM.strip())
    owner_email_ready = bool(settings.KOMA_OWNER_EMAIL.strip())
    whatsapp_enabled = bool(settings.KOMA_WHATSAPP_AUTOMATION_ENABLED)
    owner_whatsapp_ready = bool(os.getenv("KOMA_OWNER_WHATSAPP_PHONE", "").strip())

    access_token_var = "KOMA_SAAS_MERCADO_PAGO_TEST_ACCESS_TOKEN" if is_homologation else "KOMA_SAAS_MERCADO_PAGO_ACCESS_TOKEN"
    public_key_var = "KOMA_SAAS_MERCADO_PAGO_TEST_PUBLIC_KEY" if is_homologation else "KOMA_SAAS_MERCADO_PAGO_PUBLIC_KEY"
    webhook_secret_var = "KOMA_SAAS_MERCADO_PAGO_TEST_WEBHOOK_SECRET" if is_homologation else "KOMA_SAAS_MERCADO_PAGO_WEBHOOK_SECRET"

    checks = [
        _check(
            "isolated-environment",
            "Ambiente isolado",
            is_homologation,
            f"ENVIRONMENT={environment}",
            scope="payment",
        ),
        _check(
            "mercado-pago-test-access-token",
            "Access token TEST do Mercado Pago",
            test_credentials_ready,
            "Credencial de teste configurada (TEST-)" if test_credentials_ready else (
                f"Falta {access_token_var} (obrigatório iniciar com TEST-)" if is_homologation else f"Falta {access_token_var}"
            ),
            scope="payment",
        ),
        _check(
            "mercado-pago-test-public-key",
            "Public key TEST do Mercado Pago",
            bool(public_key),
            "Configurada" if public_key else f"Falta {public_key_var}",
            scope="payment",
        ),
        _check(
            "mercado-pago-webhook-secret",
            "Secret do webhook Mercado Pago",
            bool(webhook_secret),
            "Configurado" if webhook_secret else f"Falta {webhook_secret_var}",
            scope="payment",
        ),
        _check(
            "checkout-enabled",
            "Checkout SaaS habilitado",
            checkout_enabled,
            "KOMA_SAAS_CHECKOUT_ENABLED=true" if checkout_enabled else "Bloqueado: defina KOMA_SAAS_CHECKOUT_ENABLED=true após inserir as credenciais TEST",
            scope="payment",
        ),
        _check(
            "manual-release",
            "Liberação manual pelo SuperAdmin",
            bool(settings.KOMA_SAAS_MANUAL_RELEASE_REQUIRED),
            "Pronta: pagamento fica em awaiting_release" if settings.KOMA_SAAS_MANUAL_RELEASE_REQUIRED else "Bloqueado: defina KOMA_SAAS_MANUAL_RELEASE_REQUIRED=true",
            scope="payment",
        ),
        _check(
            "public-app-url",
            "Links apontam para homologação",
            _public_app_matches_environment(public_app_url, is_homologation),
            f"Aponta para {public_app_url}" if _public_app_matches_environment(public_app_url, is_homologation) else (
                f"Configure KOMA_PUBLIC_APP_URL para o frontend de homologação (atual: {public_app_url})" if public_app_url else "Configure KOMA_PUBLIC_APP_URL para o frontend de homologação"
            ),
            scope="payment",
        ),
        _check(
            "outbox-worker",
            "Worker de notificações",
            outbox_worker_enabled,
            "Pronto: worker ativo" if outbox_worker_enabled else "Bloqueado: defina ENABLE_OUTBOX_WORKER=true",
            scope="delivery",
        ),
        _check(
            "email-provider",
            "E-mail transacional",
            email_ready,
            "Pronto: Resend e remetente configurados" if email_ready else "Falta RESEND_API_KEY e/ou EMAIL_FROM",
            scope="delivery",
        ),
        _check(
            "owner-email",
            "E-mail do operador KÔMA",
            owner_email_ready,
            "Pronto: e-mail configurado" if owner_email_ready else "Falta KOMA_OWNER_EMAIL",
            scope="delivery",
        ),
        _check(
            "whatsapp-automation",
            "Automação WhatsApp",
            whatsapp_enabled,
            "Pronto: automação ativa" if whatsapp_enabled else "Pendente: defina KOMA_WHATSAPP_AUTOMATION_ENABLED=true",
            scope="delivery",
        ),
        _check(
            "owner-whatsapp",
            "WhatsApp do operador KÔMA",
            owner_whatsapp_ready,
            "Pronto: telefone configurado" if owner_whatsapp_ready else "Falta KOMA_OWNER_WHATSAPP_PHONE",
            scope="delivery",
        ),
    ]

    payment_checks = [item for item in checks if item["scope"] == "payment"]
    delivery_checks = [item for item in checks if item["scope"] == "delivery"]
    ready_for_payments = all(bool(item["ready"]) for item in payment_checks)
    ready_for_end_to_end = ready_for_payments and all(bool(item["ready"]) for item in delivery_checks)

    return {
        "environment": environment,
        "readyForPayments": ready_for_payments,
        "readyForEndToEnd": ready_for_end_to_end,
        "paymentBlockers": [item["id"] for item in payment_checks if not item["ready"]],
        "deliveryBlockers": [item["id"] for item in delivery_checks if not item["ready"]],
        "webhookUrl": webhook_url,
        "publicAppUrl": public_app_url,
        "checks": checks,
    }
