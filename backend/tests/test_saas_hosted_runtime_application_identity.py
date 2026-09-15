from __future__ import annotations

import pytest

from app.services.saas_mercadopago import SaasMercadoPagoError
from app.services.saas_mercadopago_hosted_plans import HostedPlanSaasMercadoPagoService


def _service(monkeypatch) -> HostedPlanSaasMercadoPagoService:
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("MERCADO_PAGO_CLIENT_ID", "runtime-app-123")
    monkeypatch.setenv("KOMA_SAAS_MERCADO_PAGO_EXPECTED_APPLICATION_ID", "stale-app-999")
    monkeypatch.setenv("KOMA_SAAS_MERCADO_PAGO_EXPECTED_COLLECTOR_ID", "collector-456")
    return HostedPlanSaasMercadoPagoService("APP_USR-production-token")


def test_hosted_plan_uses_runtime_client_id_instead_of_stale_expected_application(monkeypatch):
    service = _service(monkeypatch)

    service._validate_hosted_plan_identity(
        {
            "application_id": "runtime-app-123",
            "collector_id": "collector-456",
        }
    )


def test_real_subscription_uses_runtime_client_id_after_hosted_checkout(monkeypatch):
    service = _service(monkeypatch)

    service._validate_merchant_identity(
        {
            "application_id": "runtime-app-123",
            "collector_id": "collector-456",
        }
    )


def test_hosted_plan_still_fails_closed_for_application_mismatch(monkeypatch):
    service = _service(monkeypatch)

    with pytest.raises(SaasMercadoPagoError, match="aplicação diferente") as exc:
        service._validate_hosted_plan_identity(
            {
                "application_id": "other-app",
                "collector_id": "collector-456",
            }
        )
    assert exc.value.status_code == 409


def test_subscription_still_fails_closed_for_collector_mismatch(monkeypatch):
    service = _service(monkeypatch)

    with pytest.raises(SaasMercadoPagoError, match="conta recebedora diferente") as exc:
        service._validate_merchant_identity(
            {
                "application_id": "runtime-app-123",
                "collector_id": "other-collector",
            }
        )
    assert exc.value.status_code == 409


def test_legacy_expected_application_remains_fallback_without_client_id(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.delenv("MERCADO_PAGO_CLIENT_ID", raising=False)
    monkeypatch.setenv("KOMA_SAAS_MERCADO_PAGO_EXPECTED_APPLICATION_ID", "legacy-app")
    monkeypatch.delenv("KOMA_SAAS_MERCADO_PAGO_EXPECTED_COLLECTOR_ID", raising=False)
    service = HostedPlanSaasMercadoPagoService("APP_USR-production-token")

    service._validate_hosted_plan_identity({"application_id": "legacy-app"})
