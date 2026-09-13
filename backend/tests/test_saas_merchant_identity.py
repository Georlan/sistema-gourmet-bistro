from __future__ import annotations

import pytest

from app.services.saas_mercadopago import SaasMercadoPagoError, SaasMercadoPagoService


def _service(monkeypatch) -> SaasMercadoPagoService:
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("KOMA_SAAS_MERCADO_PAGO_EXPECTED_COLLECTOR_ID", "collector-123")
    monkeypatch.setenv("KOMA_SAAS_MERCADO_PAGO_EXPECTED_APPLICATION_ID", "app-456")
    return SaasMercadoPagoService("APP_USR-production-token")


def test_expected_merchant_identity_accepts_matching_payload(monkeypatch):
    service = _service(monkeypatch)
    service._validate_merchant_identity(
        {"collector_id": "collector-123", "application_id": "app-456"}
    )


def test_expected_merchant_identity_rejects_wrong_collector(monkeypatch):
    service = _service(monkeypatch)
    with pytest.raises(SaasMercadoPagoError, match="conta recebedora diferente") as exc:
        service._validate_merchant_identity(
            {"collector_id": "other-collector", "application_id": "app-456"}
        )
    assert exc.value.status_code == 409


def test_expected_merchant_identity_rejects_wrong_application(monkeypatch):
    service = _service(monkeypatch)
    with pytest.raises(SaasMercadoPagoError, match="aplicação diferente") as exc:
        service._validate_merchant_identity(
            {"collector_id": "collector-123", "application_id": "other-app"}
        )
    assert exc.value.status_code == 409


def test_expected_merchant_identity_fails_closed_when_provider_omits_identity(monkeypatch):
    service = _service(monkeypatch)
    with pytest.raises(SaasMercadoPagoError, match="conta recebedora diferente"):
        service._validate_merchant_identity({})


def test_merchant_identity_guard_is_optional_when_not_configured(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.delenv("KOMA_SAAS_MERCADO_PAGO_EXPECTED_COLLECTOR_ID", raising=False)
    monkeypatch.delenv("KOMA_SAAS_MERCADO_PAGO_EXPECTED_APPLICATION_ID", raising=False)
    service = SaasMercadoPagoService("APP_USR-production-token")
    service._validate_merchant_identity({})
