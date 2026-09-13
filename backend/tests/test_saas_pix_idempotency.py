from __future__ import annotations

from decimal import Decimal

from app.services.saas_mercadopago import SaasMercadoPagoService


class _FakeResponse:
    status_code = 201
    headers = {"content-type": "application/json"}
    text = ""

    def __init__(self, subscription_id: str):
        self.subscription_id = subscription_id

    def json(self):
        return {
            "id": self.subscription_id,
            "status": "pending",
            "init_point": f"https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id={self.subscription_id}",
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
        return _FakeResponse(f"subscription-{len(self.calls)}")


def _create_pix_automatic(service: SaasMercadoPagoService, protocol: str):
    return service.create_pix_automatic_preapproval(
        protocol=protocol,
        plan="pro",
        billing_cycle="annual",
        amount=Decimal("2257.20"),
        payer_email="reliability@example.com",
    )


def test_pix_automatic_retries_send_same_provider_idempotency_key(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    service = SaasMercadoPagoService("APP_USR-test-real-shaped-token")
    calls: list[dict] = []
    monkeypatch.setattr(service, "_client", lambda: _FakeClient(calls))

    protocol = "KOMA-CTR-20260912-A1B2C3D4E5F6"
    _create_pix_automatic(service, protocol)
    _create_pix_automatic(service, protocol)
    _create_pix_automatic(service, "KOMA-CTR-20260912-ABCDEF123456")

    assert len(calls) == 3
    assert all(call["path"] == "/preapproval" for call in calls)
    assert all(call["json"]["status"] == "pending" for call in calls)
    assert all(call["json"]["auto_recurring"]["free_trial"]["frequency"] == 7 for call in calls)

    first_key = calls[0]["headers"].get("X-Idempotency-Key")
    retry_key = calls[1]["headers"].get("X-Idempotency-Key")
    other_contract_key = calls[2]["headers"].get("X-Idempotency-Key")

    assert first_key
    assert retry_key == first_key
    assert other_contract_key
    assert other_contract_key != first_key
