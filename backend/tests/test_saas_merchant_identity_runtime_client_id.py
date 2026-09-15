from __future__ import annotations

from app.services.saas_mercadopago import SaasMercadoPagoService


def test_runtime_client_id_is_canonical_application_identity(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("MERCADO_PAGO_CLIENT_ID", "app-runtime-123")
    monkeypatch.setenv("KOMA_SAAS_MERCADO_PAGO_EXPECTED_APPLICATION_ID", "app-stale-999")
    monkeypatch.delenv("KOMA_SAAS_MERCADO_PAGO_EXPECTED_COLLECTOR_ID", raising=False)

    service = SaasMercadoPagoService("APP_USR-production-token")
    service._validate_merchant_identity(
        {"application_id": "app-runtime-123"}
    )
