import datetime
import json
from decimal import Decimal

import httpx

from app.services.online_payments.mercado_pago import MercadoPagoProvider


def _provider_with_capture(captured_requests: list[httpx.Request]) -> MercadoPagoProvider:
    def handler(request: httpx.Request) -> httpx.Response:
        captured_requests.append(request)
        payload = json.loads(request.content)
        return httpx.Response(
            201,
            json={
                "id": 987654321,
                "status": "pending",
                "transaction_amount": payload["transaction_amount"],
                "external_reference": payload["external_reference"],
                "date_of_expiration": payload["date_of_expiration"],
                "point_of_interaction": {
                    "transaction_data": {
                        "qr_code": "pix-code-test",
                        "qr_code_base64": "pix-base64-test",
                    }
                },
            },
        )

    provider = MercadoPagoProvider("test-token")
    provider._client = httpx.Client(
        base_url=provider.API_URL,
        transport=httpx.MockTransport(handler),
    )
    return provider


def test_create_pix_omits_application_fee_when_marketplace_fee_is_zero():
    captured_requests: list[httpx.Request] = []
    provider = _provider_with_capture(captured_requests)

    provider.create_pix(
        amount=Decimal("48.00"),
        marketplace_fee=Decimal("0.00"),
        payer_email="cliente.koma@example.com",
        external_reference="intent-zero-fee",
        idempotency_key="koma-online-intent-zero-fee",
        notification_url="https://api.example.test/payments/webhooks/mercado-pago/account-id",
        expires_at=datetime.datetime(2026, 9, 2, 4, 0, tzinfo=datetime.timezone.utc),
    )

    assert len(captured_requests) == 1
    request = captured_requests[0]
    payload = json.loads(request.content)

    assert "application_fee" not in payload
    assert payload["transaction_amount"] == 48.0
    assert payload["payment_method_id"] == "pix"
    assert payload["external_reference"] == "intent-zero-fee"
    assert request.headers["X-Idempotency-Key"] == "koma-online-intent-zero-fee"


def test_create_pix_sends_application_fee_without_changing_payment_contract():
    captured_requests: list[httpx.Request] = []
    provider = _provider_with_capture(captured_requests)

    payment = provider.create_pix(
        amount=Decimal("48.00"),
        marketplace_fee=Decimal("0.43"),
        payer_email="cliente.koma@example.com",
        external_reference="intent-with-fee",
        idempotency_key="koma-online-intent-with-fee",
        notification_url="https://api.example.test/payments/webhooks/mercado-pago/account-id",
        expires_at=datetime.datetime(2026, 9, 2, 4, 0, tzinfo=datetime.timezone.utc),
    )

    assert len(captured_requests) == 1
    request = captured_requests[0]
    payload = json.loads(request.content)

    assert payload["application_fee"] == 0.43
    assert payload["transaction_amount"] == 48.0
    assert payload["payer"] == {"email": "cliente.koma@example.com"}
    assert payload["external_reference"] == "intent-with-fee"
    assert payload["notification_url"] == "https://api.example.test/payments/webhooks/mercado-pago/account-id"
    assert payload["date_of_expiration"] == "2026-09-02T04:00:00.000+00:00"
    assert request.headers["X-Idempotency-Key"] == "koma-online-intent-with-fee"
    assert payment.external_id == "987654321"
    assert payment.status == "pending"
    assert payment.qr_code == "pix-code-test"
