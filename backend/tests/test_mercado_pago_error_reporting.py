from __future__ import annotations

import datetime
from decimal import Decimal

import httpx
import pytest

from app.services.online_payments.mercado_pago import MercadoPagoError, MercadoPagoProvider


def test_create_pix_preserves_only_sanitized_provider_error(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/payments"
        return httpx.Response(
            400,
            json={
                "message": "invalid_application_fee",
                "access_token": "must-never-be-exposed",
                "payer": {"email": "must-never-be-exposed@example.com"},
            },
        )

    provider = MercadoPagoProvider("secret-access-token")
    provider._client.close()
    provider._client = httpx.Client(
        base_url=provider.API_URL,
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(MercadoPagoError) as exc_info:
        provider.create_pix(
            amount=Decimal("100.00"),
            marketplace_fee=Decimal("0.69"),
            payer_email="cliente@example.com",
            external_reference="intent-123",
            idempotency_key="koma-online-intent-123",
            notification_url="https://api.example.test/payments/webhooks/mercado-pago/account-1",
            expires_at=datetime.datetime.now(datetime.timezone.utc)
            + datetime.timedelta(minutes=30),
        )

    error = exc_info.value
    assert error.status_code == 400
    assert error.retryable is False
    assert "invalid_application_fee" in str(error)
    assert "must-never-be-exposed" not in str(error)
    assert "cliente@example.com" not in str(error)
    assert "secret-access-token" not in str(error)
