import datetime as dt
from contextlib import nullcontext
from decimal import Decimal
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


class _FakeSubscriptionQuery:
    def __init__(self, subscription):
        self.subscription = subscription

    def filter(self, *_args, **_kwargs):
        return self

    def with_for_update(self):
        return self

    def one_or_none(self):
        return self.subscription


class _FakeDb:
    def __init__(self, subscription):
        self.subscription = subscription
        self.commits = 0

    def query(self, _model):
        return _FakeSubscriptionQuery(self.subscription)

    def commit(self):
        self.commits += 1


def _plan_changed_invoice_fixture(monkeypatch, *, paid_amount: str):
    billing = SimpleNamespace(
        restaurante_id=77,
        payment_method_type="credit_card",
        provider_subscription_id="sub-77",
        protocol="KOMA-CTR-20260901-OLDPRO123456",
    )
    subscription = SimpleNamespace(
        billing_cycle="monthly",
        current_period_start=None,
        current_period_end=None,
        status="active",
        grace_until=None,
        updated_at=None,
    )
    db = _FakeDb(subscription)

    monkeypatch.setattr(
        reconciliation,
        "tenant_session_scope",
        lambda _db, _restaurant_id: nullcontext(),
    )
    monkeypatch.setattr(
        reconciliation,
        "get_billing_setup_by_provider_sub",
        lambda _db, _provider, _sub_id: billing,
    )
    monkeypatch.setattr(
        reconciliation,
        "tenant_commercial_terms",
        lambda _db, _restaurant_id: SimpleNamespace(
            billing_amount=Decimal("249.00"),
        ),
    )
    monkeypatch.setattr(
        reconciliation,
        "contract_billing_terms",
        lambda *_args, **_kwargs: pytest.fail(
            "tenant ativo deve usar o aceite comercial vigente, não o protocolo antigo"
        ),
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
        reconciliation.default_saas_mp_service,
        "get_preapproval",
        lambda _sub_id: {
            "id": "sub-77",
            "status": "authorized",
            # A autorização original continua referenciando o contrato antigo.
            "external_reference": billing.protocol,
        },
    )
    monkeypatch.setattr(
        reconciliation.default_saas_mp_service,
        "get_payment",
        lambda _payment_id: {
            "id": "pay-77",
            "status": "approved",
            "transaction_amount": paid_amount,
            "currency_id": "BRL",
            "payment_method_id": "visa",
            "date_approved": "2026-09-18T20:00:00Z",
        },
    )
    return db, subscription


def test_recurring_invoice_after_plan_change_uses_current_tenant_contract(monkeypatch):
    db, subscription = _plan_changed_invoice_fixture(
        monkeypatch,
        paid_amount="249.00",
    )

    result = reconciliation.reconcile_invoice(db, "invoice-77")

    assert result == {"status": "received", "reconciled": True}
    assert subscription.current_period_start == dt.datetime(
        2026,
        9,
        18,
        20,
        0,
        tzinfo=dt.timezone.utc,
    )
    assert subscription.current_period_end is not None
    assert db.commits == 1


def test_recurring_invoice_after_plan_change_rejects_old_plan_amount(monkeypatch):
    db, subscription = _plan_changed_invoice_fixture(
        monkeypatch,
        paid_amount="129.00",
    )

    result = reconciliation.reconcile_invoice(db, "invoice-77")

    assert result == {
        "status": "received",
        "reconciled": False,
        "reason": "billing_amount_mismatch",
    }
    assert subscription.current_period_start is None
    assert subscription.current_period_end is None
    assert db.commits == 0


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
