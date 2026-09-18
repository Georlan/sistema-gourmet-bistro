from __future__ import annotations

from decimal import Decimal

import pytest

from app.services.saas_mercadopago import SaasMercadoPagoError
from app.services.saas_mercadopago_hosted_plans import HostedPlanSaasMercadoPagoService


class FakeResponse:
    def __init__(self, payload: dict):
        self.status_code = 201
        self._payload = payload
        self.headers = {"content-type": "application/json"}
        self.text = str(payload)

    def json(self):
        return self._payload


class FakeClient:
    def __init__(self, payload: dict):
        self.response = FakeResponse(payload)

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def post(self, *_args, **_kwargs):
        return self.response


def _service(monkeypatch, payload: dict) -> HostedPlanSaasMercadoPagoService:
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("KOMA_SAAS_MERCADO_PAGO_EXPECTED_COLLECTOR_ID", "collector-123")
    monkeypatch.setenv("KOMA_SAAS_MERCADO_PAGO_EXPECTED_APPLICATION_ID", "app-456")
    service = HostedPlanSaasMercadoPagoService("APP_USR-production-token")
    monkeypatch.setattr(service, "_client", lambda: FakeClient(payload))
    return service


def test_hosted_plan_accepts_response_without_application_or_collector(monkeypatch):
    service = _service(
        monkeypatch,
        {
            "id": "plan-1",
            "status": "active",
            "init_point": "https://www.mercadopago.com.br/subscriptions/checkout?preapproval_plan_id=plan-1",
        },
    )

    result = service.create_pix_automatic_preapproval(
        protocol="KOMA-CTR-20260915-ABCDEF123456",
        plan="premium",
        billing_cycle="monthly",
        amount=Decimal("249.00"),
        payer_email="cliente@example.com",
    )

    assert result["id"] == "plan:plan-1"
    assert result["status"] == "pending"


def test_hosted_plan_rejects_explicit_application_mismatch(monkeypatch):
    service = _service(
        monkeypatch,
        {
            "id": "plan-2",
            "status": "active",
            "init_point": "https://www.mercadopago.com.br/subscriptions/checkout?preapproval_plan_id=plan-2",
            "application_id": "other-app",
        },
    )

    with pytest.raises(SaasMercadoPagoError, match="aplicação diferente") as exc_info:
        service.create_pix_automatic_preapproval(
            protocol="KOMA-CTR-20260915-123456ABCDEF",
            plan="premium",
            billing_cycle="monthly",
            amount=Decimal("249.00"),
            payer_email="cliente@example.com",
        )

    assert exc_info.value.status_code == 409


def test_hosted_plan_rejects_explicit_collector_mismatch(monkeypatch):
    service = _service(
        monkeypatch,
        {
            "id": "plan-3",
            "status": "active",
            "init_point": "https://www.mercadopago.com.br/subscriptions/checkout?preapproval_plan_id=plan-3",
            "collector_id": "other-collector",
        },
    )

    with pytest.raises(SaasMercadoPagoError, match="conta recebedora diferente") as exc_info:
        service.create_account_money_preapproval(
            protocol="KOMA-CTR-20260915-FFEEDDCCBBAA",
            plan="pro",
            billing_cycle="monthly",
            amount=Decimal("129.00"),
            payer_email="cliente@example.com",
        )

    assert exc_info.value.status_code == 409
