from types import SimpleNamespace

import pytest

from app.services import saas_invoice_reconciliation as reconciliation
from app.services.saas_mercadopago import SaasMercadoPagoError


@pytest.mark.parametrize(
    "payment_method_type",
    ["credit_card", "pix_automatic", "account_money"],
)
def test_all_recurring_trial_methods_enter_invoice_verification(monkeypatch, payment_method_type):
    billing = SimpleNamespace(
        restaurante_id=77,
        payment_method_type=payment_method_type,
        provider_subscription_id="sub-77",
        protocol="KOMA-CTR-20260914-AABBCCDDEEFF",
    )
    monkeypatch.setattr(
        reconciliation.default_saas_mp_service,
        "get_authorized_payment",
        lambda _invoice_id: {
            "id": "invoice-77",
            "preapproval_id": "sub-77",
            "payment": {"id": "pay-77"},
        },
    )
    monkeypatch.setattr(
        reconciliation,
        "get_billing_setup_by_provider_sub",
        lambda _db, _provider, _sub_id: billing,
    )

    payment_calls = []

    def fail_after_method_gate(payment_id):
        payment_calls.append(payment_id)
        raise SaasMercadoPagoError("simulated missing payment", status_code=404)

    monkeypatch.setattr(
        reconciliation.default_saas_mp_service,
        "get_payment",
        fail_after_method_gate,
    )

    result = reconciliation.reconcile_invoice(object(), "invoice-77")

    assert payment_calls == ["pay-77"]
    assert result == {
        "status": "received",
        "reconciled": False,
        "reason": "payment_or_mandate_not_found",
    }


def test_legacy_upfront_pix_does_not_enter_recurring_invoice_reconciliation(monkeypatch):
    billing = SimpleNamespace(
        restaurante_id=77,
        payment_method_type="pix",
        provider_subscription_id=None,
        protocol="KOMA-CTR-20260914-FFEEDDCCBBAA",
    )
    monkeypatch.setattr(
        reconciliation.default_saas_mp_service,
        "get_authorized_payment",
        lambda _invoice_id: {
            "id": "invoice-legacy",
            "preapproval_id": "legacy-pix",
            "payment": {"id": "pay-legacy"},
        },
    )
    monkeypatch.setattr(
        reconciliation,
        "get_billing_setup_by_provider_sub",
        lambda _db, _provider, _sub_id: billing,
    )
    monkeypatch.setattr(
        reconciliation.default_saas_mp_service,
        "get_payment",
        lambda _payment_id: pytest.fail("legacy Pix must not be reconciled as a subscription invoice"),
    )

    assert reconciliation.reconcile_invoice(object(), "invoice-legacy") == {
        "status": "received",
        "reconciled": False,
    }


@pytest.mark.parametrize(
    ("local_method", "provider_method", "expected"),
    [
        ("credit_card", "visa", True),
        ("credit_card", "master", True),
        ("pix_automatic", "pix", True),
        ("pix_automatic", "visa", False),
        ("account_money", "account_money", True),
        ("account_money", "pix", False),
    ],
)
def test_invoice_payment_method_guard(local_method, provider_method, expected):
    assert (
        reconciliation._payment_method_matches_subscription(local_method, provider_method)
        is expected
    )
