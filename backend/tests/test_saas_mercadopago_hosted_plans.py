from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace

import pytest

import app.services as services_package
from app.services.saas_mercadopago import SaasMercadoPagoError
from app.services.saas_mercadopago_hosted_plans import HostedPlanSaasMercadoPagoService


class FakeResponse:
    def __init__(self, status_code: int, payload: dict):
        self.status_code = status_code
        self._payload = payload
        self.headers = {"content-type": "application/json"}
        self.text = str(payload)

    def json(self):
        return self._payload


class RecordingClient:
    def __init__(self, *, post_response: FakeResponse | None = None, get_responses: dict[str, FakeResponse] | None = None):
        self.post_response = post_response
        self.get_responses = get_responses or {}
        self.posts: list[dict] = []
        self.gets: list[dict] = []

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def post(self, path, *, json=None, headers=None):
        self.posts.append({"path": path, "json": json, "headers": headers})
        assert self.post_response is not None
        return self.post_response

    def get(self, path, *, params=None):
        self.gets.append({"path": path, "params": params})
        response = self.get_responses.get(path)
        assert response is not None, f"GET inesperado: {path}"
        return response


def _production_service(monkeypatch) -> HostedPlanSaasMercadoPagoService:
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.delenv("KOMA_SAAS_MERCADO_PAGO_EXPECTED_COLLECTOR_ID", raising=False)
    monkeypatch.delenv("KOMA_SAAS_MERCADO_PAGO_EXPECTED_APPLICATION_ID", raising=False)
    return HostedPlanSaasMercadoPagoService("APP_USR-testable-production-shape")


def test_pix_automatic_uses_preapproval_plan_hosted_checkout(monkeypatch):
    service = _production_service(monkeypatch)
    client = RecordingClient(
        post_response=FakeResponse(
            201,
            {
                "id": "plan-pix-1",
                "status": "active",
                "init_point": "https://www.mercadopago.com.br/subscriptions/checkout?preapproval_plan_id=plan-pix-1",
                "auto_recurring": {
                    "frequency": 1,
                    "frequency_type": "months",
                    "transaction_amount": 249.0,
                    "currency_id": "BRL",
                    "free_trial": {"frequency": 7, "frequency_type": "days"},
                },
            },
        )
    )
    monkeypatch.setattr(service, "_client", lambda: client)

    result = service.create_pix_automatic_preapproval(
        protocol="KOMA-CTR-20260914-ABCDEF123456",
        plan="premium",
        billing_cycle="monthly",
        amount=Decimal("249.00"),
        payer_email="cliente@example.com",
        back_url="https://homolog.komafood.test/legal/contrato/confirmacao",
    )

    assert result["id"] == "plan:plan-pix-1"
    assert result["status"] == "pending"
    assert result["external_reference"] == "KOMA-CTR-20260914-ABCDEF123456"
    assert result["init_point"].endswith("preapproval_plan_id=plan-pix-1")
    assert len(client.posts) == 1
    sent = client.posts[0]
    assert sent["path"] == "/preapproval_plan"
    assert sent["json"]["auto_recurring"]["free_trial"] == {"frequency": 7, "frequency_type": "days"}
    assert sent["json"]["payment_methods_allowed"] == {"payment_methods": [{"id": "pix"}]}
    assert "external_reference" not in sent["json"]
    assert "koma_protocol=KOMA-CTR-20260914-ABCDEF123456" in sent["json"]["back_url"]
    assert sent["headers"]["X-Idempotency-Key"]


def test_hosted_plan_rejects_provider_amount_different_from_vnext_contract(monkeypatch):
    service = _production_service(monkeypatch)
    client = RecordingClient(
        post_response=FakeResponse(
            201,
            {
                "id": "plan-stale-pro",
                "status": "active",
                "init_point": (
                    "https://www.mercadopago.com.br/subscriptions/checkout"
                    "?preapproval_plan_id=plan-stale-pro"
                ),
                "auto_recurring": {
                    "frequency": 1,
                    "frequency_type": "months",
                    "transaction_amount": 209.0,
                    "currency_id": "BRL",
                    "free_trial": {"frequency": 7, "frequency_type": "days"},
                },
            },
        )
    )
    monkeypatch.setattr(service, "_client", lambda: client)

    with pytest.raises(
        SaasMercadoPagoError,
        match="valor diferente do contrato",
    ):
        service.create_account_money_preapproval(
            protocol="KOMA-CTR-20260918-STALE209ABCD",
            plan="pro",
            billing_cycle="monthly",
            amount=Decimal("129.00"),
            payer_email="cliente@example.com",
            back_url="https://homolog.komafood.test/legal/contrato/confirmacao",
        )


def test_account_money_uses_dedicated_allowed_payment_method(monkeypatch):
    service = _production_service(monkeypatch)
    client = RecordingClient(
        post_response=FakeResponse(
            201,
            {
                "id": "plan-wallet-1",
                "status": "active",
                "init_point": "https://www.mercadopago.com.br/subscriptions/checkout?preapproval_plan_id=plan-wallet-1",
            },
        )
    )
    monkeypatch.setattr(service, "_client", lambda: client)

    result = service.create_account_money_preapproval(
        protocol="KOMA-CTR-20260914-123456ABCDEF",
        plan="pro",
        billing_cycle="monthly",
        amount=Decimal("129.00"),
        payer_email="cliente@example.com",
        back_url="https://homolog.komafood.test/legal/contrato/confirmacao",
    )

    assert result["id"] == "plan:plan-wallet-1"
    assert result["provider_plan_id"] == "plan-wallet-1"
    sent = client.posts[0]["json"]
    assert sent["reason"] == "KÔMA - Plano Pro (Mensal)"
    assert sent["auto_recurring"]["transaction_amount"] == 129.0
    assert sent["auto_recurring"]["currency_id"] == "BRL"
    assert sent["payment_methods_allowed"] == {
        "payment_methods": [{"id": "account_money"}]
    }


def test_plan_marker_resolves_real_subscription_and_enriches_contract_terms(monkeypatch):
    service = _production_service(monkeypatch)
    protocol = "KOMA-CTR-20260914-A1B2C3D4E5F6"
    plan_payload = {
        "id": "plan-1",
        "status": "active",
        "back_url": f"https://homolog.komafood.test/legal/contrato/confirmacao?koma_protocol={protocol}",
        "init_point": "https://www.mercadopago.com.br/subscriptions/checkout?preapproval_plan_id=plan-1",
        "auto_recurring": {
            "frequency": 1,
            "frequency_type": "months",
            "transaction_amount": 129.0,
            "currency_id": "BRL",
            "free_trial": {"frequency": 7, "frequency_type": "days"},
        },
    }
    client = RecordingClient(
        get_responses={
            "/preapproval_plan/plan-1": FakeResponse(200, plan_payload),
            "/preapproval/search": FakeResponse(200, {"results": [{"id": "sub-1", "status": "authorized"}]}),
            "/preapproval/sub-1": FakeResponse(
                200,
                {
                    "id": "sub-1",
                    "status": "authorized",
                    "payment_method_id": "pix",
                    "preapproval_plan_id": "plan-1",
                    "payer_id": "payer-1",
                    "auto_recurring": {
                        "frequency": 1,
                        "frequency_type": "months",
                        "transaction_amount": 129.0,
                        "currency_id": "BRL",
                    },
                },
            ),
        }
    )
    monkeypatch.setattr(service, "_client", lambda: client)

    mandate = service.get_preapproval("plan:plan-1")

    assert mandate["id"] == "sub-1"
    assert mandate["status"] == "authorized"
    assert mandate["payment_method_id"] == "pix"
    assert mandate["external_reference"] == protocol
    assert mandate["auto_recurring"]["free_trial"] == {"frequency": 7, "frequency_type": "days"}


def test_unprefixed_plan_id_is_not_mistaken_for_subscription(monkeypatch):
    service = _production_service(monkeypatch)
    client = RecordingClient(
        get_responses={
            "/preapproval/plan-raw-id": FakeResponse(404, {"message": "not found"}),
        }
    )
    monkeypatch.setattr(service, "_client", lambda: client)

    with pytest.raises(SaasMercadoPagoError) as exc_info:
        service.get_preapproval("plan-raw-id")

    assert exc_info.value.status_code == 404
    assert [entry["path"] for entry in client.gets] == ["/preapproval/plan-raw-id"]


def test_plan_marker_is_persisted_as_payment_reference_not_subscription_id(monkeypatch):
    captured = {}

    def fake_original(_db, **kwargs):
        captured.update(kwargs)
        return "setup-1"

    monkeypatch.setattr(services_package, "_original_upsert_billing_setup", fake_original)

    result = services_package._hosted_plan_aware_upsert_billing_setup(
        object(),
        protocol="KOMA-CTR-20260914-FFEEDDCCBBAA",
        contract_acceptance_id="accept-vnext-premium",
        payment_method_type="pix_automatic",
        provider_subscription_id="plan:plan-99",
        billing_cycle="monthly",
    )

    assert result == "setup-1"
    assert captured["provider_subscription_id"] is None
    assert captured["provider_payment_method_reference"] == "plan:plan-99"
    assert captured["contract_acceptance_id"] == "accept-vnext-premium"


def test_real_subscription_webhook_is_linked_back_to_plan_marker(monkeypatch):
    protocol = "KOMA-CTR-20260914-112233AABBCC"
    pending = SimpleNamespace(
        protocol=protocol,
        contract_acceptance_id="accept-1",
        provider="mercado_pago",
        payment_method_type="pix_automatic",
        status="pending",
        provider_customer_id=None,
        provider_payment_method_reference="plan:plan-42",
        provider_subscription_id=None,
        billing_cycle="monthly",
    )
    linked = SimpleNamespace(**{**pending.__dict__, "provider_subscription_id": "sub-42"})
    state = {"linked": False, "upsert": None}

    def fake_lookup(_db, provider, sub_id):
        assert provider == "mercado_pago"
        if sub_id == "sub-42":
            return linked if state["linked"] else None
        if sub_id == "plan:plan-42":
            return pending
        return None

    def fake_upsert(_db, **kwargs):
        state["upsert"] = kwargs
        state["linked"] = True
        return "setup-42"

    class FakeDb:
        flushed = False

        def flush(self):
            self.flushed = True

    db = FakeDb()
    monkeypatch.setattr(services_package, "_original_get_billing_setup_by_provider_sub", fake_lookup)
    monkeypatch.setattr(services_package, "_original_upsert_billing_setup", fake_upsert)
    monkeypatch.setattr(
        services_package._hosted_saas_mp_service,
        "get_preapproval",
        lambda _sub_id: {
            "id": "sub-42",
            "status": "authorized",
            "payment_method_id": "pix",
            "preapproval_plan_id": "plan-42",
            "payer_id": "payer-42",
        },
    )

    result = services_package._hosted_plan_aware_get_billing_setup_by_provider_sub(
        db,
        "mercado_pago",
        "sub-42",
    )

    assert result.provider_subscription_id == "sub-42"
    assert state["upsert"]["protocol"] == protocol
    assert state["upsert"]["provider_payment_method_reference"] == "plan:plan-42"
    assert state["upsert"]["provider_subscription_id"] == "sub-42"
    assert state["upsert"]["provider_customer_id"] == "payer-42"
    assert db.flushed is True
