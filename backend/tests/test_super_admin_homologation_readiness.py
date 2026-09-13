import json

from starlette.requests import Request

from app.config import settings
from app.routes.super_admin_homologation import get_homologation_readiness


def _request() -> Request:
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/api/super-admin/homologation/readiness",
            "root_path": "",
            "scheme": "https",
            "query_string": b"",
            "headers": [],
            "client": ("127.0.0.1", 12345),
            "server": ("api-homologacao.koma.test", 443),
        }
    )


def test_readiness_reports_complete_homologation_without_exposing_secrets(monkeypatch):
    access_token = "TEST-super-secret-token"
    public_key = "TEST-public-key"
    webhook_secret = "webhook-super-secret"
    resend_key = "re_super_secret"

    monkeypatch.setenv("ENVIRONMENT", "homologation")
    monkeypatch.setenv("KOMA_SAAS_CHECKOUT_ENABLED", "true")
    monkeypatch.setenv("ENABLE_OUTBOX_WORKER", "true")
    monkeypatch.setenv("KOMA_OWNER_WHATSAPP_PHONE", "5585999999999")
    monkeypatch.setattr(settings, "KOMA_SAAS_MERCADO_PAGO_ACCESS_TOKEN", access_token)
    monkeypatch.setattr(settings, "KOMA_SAAS_MERCADO_PAGO_PUBLIC_KEY", public_key)
    monkeypatch.setattr(settings, "KOMA_SAAS_MERCADO_PAGO_WEBHOOK_SECRET", webhook_secret)
    monkeypatch.setattr(settings, "KOMA_SAAS_MANUAL_RELEASE_REQUIRED", True)
    monkeypatch.setattr(settings, "KOMA_PUBLIC_APP_URL", "https://frontend-homologacao.example.test")
    monkeypatch.setattr(settings, "KOMA_PUBLIC_API_URL", "https://api-homologacao.example.test")
    monkeypatch.setattr(settings, "RESEND_API_KEY", resend_key)
    monkeypatch.setattr(settings, "EMAIL_FROM", "KOMA <noreply@example.test>")
    monkeypatch.setattr(settings, "KOMA_OWNER_EMAIL", "owner@example.test")
    monkeypatch.setattr(settings, "KOMA_WHATSAPP_AUTOMATION_ENABLED", True)

    result = get_homologation_readiness(_request(), admin={"user": "qa"})

    assert result["readyForPayments"] is True
    assert result["readyForEndToEnd"] is True
    assert result["paymentBlockers"] == []
    assert result["deliveryBlockers"] == []
    assert result["publicApiUrl"] == "https://api-homologacao.example.test"
    assert result["webhookPath"] == "/api/integrations/saas-billing/mercado-pago/webhook"
    assert result["webhookUrl"] == "https://api-homologacao.example.test/api/integrations/saas-billing/mercado-pago/webhook"
    assert result["webhookUrl"].endswith("/api/integrations/saas-billing/mercado-pago/webhook")
    assert "subscription_authorized_payment" in result["requiredWebhookEvents"]
    assert "payment" in result["requiredWebhookEvents"]
    assert "subscription_preapproval" in result["requiredWebhookEvents"]

    serialized = json.dumps(result)
    for secret in (access_token, public_key, webhook_secret, resend_key):
        assert secret not in serialized


def test_readiness_turns_missing_manual_release_and_checkout_into_payment_blockers(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "homologation")
    monkeypatch.setenv("KOMA_SAAS_CHECKOUT_ENABLED", "false")
    monkeypatch.setattr(settings, "KOMA_SAAS_MERCADO_PAGO_ACCESS_TOKEN", "TEST-token")
    monkeypatch.setattr(settings, "KOMA_SAAS_MERCADO_PAGO_PUBLIC_KEY", "TEST-public")
    monkeypatch.setattr(settings, "KOMA_SAAS_MERCADO_PAGO_WEBHOOK_SECRET", "secret")
    monkeypatch.setattr(settings, "KOMA_SAAS_MANUAL_RELEASE_REQUIRED", False)
    monkeypatch.setattr(settings, "KOMA_PUBLIC_APP_URL", "https://frontend-homologacao.example.test")
    monkeypatch.setattr(settings, "KOMA_PUBLIC_API_URL", "")

    result = get_homologation_readiness(_request(), admin={"user": "qa"})

    assert result["readyForPayments"] is False
    assert "checkout-enabled" in result["paymentBlockers"]
    assert "manual-release" in result["paymentBlockers"]
    assert "public-api-url" in result["paymentBlockers"]
    assert result["webhookUrl"].endswith("/api/integrations/saas-billing/mercado-pago/webhook")


def test_readiness_explicitly_names_missing_environment_variables(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "homologation")
    monkeypatch.setenv("KOMA_SAAS_CHECKOUT_ENABLED", "false")
    monkeypatch.setattr(settings, "KOMA_SAAS_MERCADO_PAGO_ACCESS_TOKEN", "")
    monkeypatch.setattr(settings, "KOMA_SAAS_MERCADO_PAGO_PUBLIC_KEY", "")
    monkeypatch.setattr(settings, "KOMA_SAAS_MERCADO_PAGO_WEBHOOK_SECRET", "")
    monkeypatch.setattr(settings, "KOMA_SAAS_MANUAL_RELEASE_REQUIRED", True)
    monkeypatch.setattr(settings, "KOMA_PUBLIC_APP_URL", "")
    monkeypatch.setattr(settings, "KOMA_PUBLIC_API_URL", "")

    result = get_homologation_readiness(_request(), admin={"user": "qa"})
    details = {item["id"]: str(item["detail"]) for item in result["checks"]}

    assert "KOMA_SAAS_MERCADO_PAGO_TEST_ACCESS_TOKEN" in details["mercado-pago-test-access-token"]
    assert "KOMA_SAAS_MERCADO_PAGO_TEST_PUBLIC_KEY" in details["mercado-pago-test-public-key"]
    assert "KOMA_SAAS_MERCADO_PAGO_TEST_WEBHOOK_SECRET" in details["mercado-pago-webhook-secret"]
    assert "KOMA_SAAS_CHECKOUT_ENABLED=true" in details["checkout-enabled"]
    assert "KOMA_PUBLIC_APP_URL" in details["public-app-url"]
    assert "KOMA_PUBLIC_API_URL" in details["public-api-url"]


def test_readiness_blocks_when_public_api_url_is_missing(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "homologation")
    monkeypatch.setenv("KOMA_SAAS_CHECKOUT_ENABLED", "true")
    monkeypatch.setattr(settings, "KOMA_SAAS_MERCADO_PAGO_ACCESS_TOKEN", "TEST-token")
    monkeypatch.setattr(settings, "KOMA_SAAS_MERCADO_PAGO_PUBLIC_KEY", "TEST-public")
    monkeypatch.setattr(settings, "KOMA_SAAS_MERCADO_PAGO_WEBHOOK_SECRET", "secret")
    monkeypatch.setattr(settings, "KOMA_SAAS_MANUAL_RELEASE_REQUIRED", True)
    monkeypatch.setattr(settings, "KOMA_PUBLIC_APP_URL", "https://frontend-homologacao.example.test")
    monkeypatch.setattr(settings, "KOMA_PUBLIC_API_URL", "")

    result = get_homologation_readiness(_request(), admin={"user": "qa"})
    details = {item["id"]: str(item["detail"]) for item in result["checks"]}

    assert result["readyForPayments"] is False
    assert "public-api-url" in result["paymentBlockers"]
    assert "KOMA_PUBLIC_API_URL" in details["public-api-url"]
    assert result["webhookUrl"].endswith("/api/integrations/saas-billing/mercado-pago/webhook")


def test_readiness_blocks_when_public_api_url_points_to_production(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "homologation")
    monkeypatch.setenv("KOMA_SAAS_CHECKOUT_ENABLED", "true")
    monkeypatch.setattr(settings, "KOMA_SAAS_MERCADO_PAGO_ACCESS_TOKEN", "TEST-token")
    monkeypatch.setattr(settings, "KOMA_SAAS_MERCADO_PAGO_PUBLIC_KEY", "TEST-public")
    monkeypatch.setattr(settings, "KOMA_SAAS_MERCADO_PAGO_WEBHOOK_SECRET", "secret")
    monkeypatch.setattr(settings, "KOMA_SAAS_MANUAL_RELEASE_REQUIRED", True)
    monkeypatch.setattr(settings, "KOMA_PUBLIC_APP_URL", "https://frontend-homologacao.example.test")
    monkeypatch.setattr(settings, "KOMA_PUBLIC_API_URL", "https://api.komafood.com.br")

    result = get_homologation_readiness(_request(), admin={"user": "qa"})
    details = {item["id"]: str(item["detail"]) for item in result["checks"]}

    assert result["readyForPayments"] is False
    assert "public-api-url" in result["paymentBlockers"]
    assert "produção" in details["public-api-url"].lower()


def test_readiness_blocks_when_public_api_url_does_not_match_homologation(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "homologation")
    monkeypatch.setenv("KOMA_SAAS_CHECKOUT_ENABLED", "true")
    monkeypatch.setattr(settings, "KOMA_SAAS_MERCADO_PAGO_ACCESS_TOKEN", "TEST-token")
    monkeypatch.setattr(settings, "KOMA_SAAS_MERCADO_PAGO_PUBLIC_KEY", "TEST-public")
    monkeypatch.setattr(settings, "KOMA_SAAS_MERCADO_PAGO_WEBHOOK_SECRET", "secret")
    monkeypatch.setattr(settings, "KOMA_SAAS_MANUAL_RELEASE_REQUIRED", True)
    monkeypatch.setattr(settings, "KOMA_PUBLIC_APP_URL", "https://frontend-homologacao.example.test")
    monkeypatch.setattr(settings, "KOMA_PUBLIC_API_URL", "https://arbitrary-unrelated-domain.com")

    result = get_homologation_readiness(_request(), admin={"user": "qa"})
    details = {item["id"]: str(item["detail"]) for item in result["checks"]}

    assert result["readyForPayments"] is False
    assert "public-api-url" in result["paymentBlockers"]
    assert "não corresponde ao backend de homologação" in details["public-api-url"].lower()

