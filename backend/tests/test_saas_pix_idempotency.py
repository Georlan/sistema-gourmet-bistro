from __future__ import annotations

from decimal import Decimal

from app.services.saas_mercadopago import SaasMercadoPagoService


class _FakeResponse:
    status_code = 201
    headers = {"content-type": "application/json"}
    text = ""

    def __init__(self, payment_id: str):
        self.payment_id = payment_id

    def json(self):
        return {
            "id": self.payment_id,
            "status": "pending",
            "point_of_interaction": {
                "transaction_data": {
                    "qr_code": "pix-copy-paste",
                    "qr_code_base64": "",
                    "ticket_url": f"https://example.invalid/{self.payment_id}",
                }
            },
            "date_of_expiration": "2026-09-13T12:00:00Z",
        }


class _FakeClient:
    def __init__(self, calls: list[dict]):
        self.calls = calls

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def post(self, path: str, *, json: dict, headers: dict | None = None):
        self.calls.append({"path": path, "json": json, "headers": headers or {}})
        return _FakeResponse(f"payment-{len(self.calls)}")


def _create_pix(service: SaasMercadoPagoService, protocol: str):
    return service.create_annual_pix(
        protocol=protocol,
        plan="pro",
        amount=Decimal("2257.20"),
        payer_email="reliability@example.com",
        payer_name="Cliente Reliability",
        payer_tax_id="52998224725",
    )


def test_annual_pix_retries_send_same_provider_idempotency_key(monkeypatch):
    service = SaasMercadoPagoService("APP_USR-test-real-shaped-token")
    calls: list[dict] = []
    monkeypatch.setattr(service, "_client", lambda: _FakeClient(calls))

    protocol = "KOMA-CTR-20260912-A1B2C3D4E5F6"
    _create_pix(service, protocol)
    _create_pix(service, protocol)
    _create_pix(service, "KOMA-CTR-20260912-ABCDEF123456")

    assert len(calls) == 3
    assert all(call["path"] == "/v1/payments" for call in calls)

    first_key = calls[0]["headers"].get("X-Idempotency-Key")
    retry_key = calls[1]["headers"].get("X-Idempotency-Key")
    other_contract_key = calls[2]["headers"].get("X-Idempotency-Key")

    assert first_key
    assert retry_key == first_key
    assert other_contract_key
    assert other_contract_key != first_key
