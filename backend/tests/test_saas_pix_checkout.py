from __future__ import annotations

import datetime as dt
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import app.routes.saas_pix as saas_pix
from app.routes.saas_pix import (
    _advance_paid_period,
    _payment_qr_payload,
    _pix_reference,
    _subscription_amount,
)
from app.saas_billing_models import SaaSSubscription
from app.services.saas_billing_policy import (
    CHECKOUT_PAYMENT_METHODS,
    is_recurring_trial_payment_method,
    is_trial_eligible_payment_method,
)


def test_checkout_contract_has_exactly_three_methods():
    assert CHECKOUT_PAYMENT_METHODS == {"credit_card", "pix", "account_money"}
    assert is_trial_eligible_payment_method("pix") is True
    assert is_recurring_trial_payment_method("pix") is False


def test_pix_reference_is_deterministic_per_tenant_and_due_date():
    due = dt.datetime(2026, 10, 1, 12, 30, tzinfo=dt.timezone.utc)
    assert _pix_reference(42, due) == "KOMA-SAAS-PIX-42-20261001"


def test_qr_payload_exposes_qr_copy_paste_and_no_automatic_renewal():
    due = dt.datetime(2026, 10, 1, tzinfo=dt.timezone.utc)
    payment = {
        "id": "123",
        "status": "pending",
        "date_of_expiration": "2026-10-02T00:00:00Z",
        "point_of_interaction": {
            "transaction_data": {
                "qr_code": "000201-koma",
                "qr_code_base64": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
                "ticket_url": "https://www.mercadopago.com.br/payments/123/ticket",
            }
        },
    }
    result = _payment_qr_payload(payment, due_at=due, amount=Decimal("129.00"))
    assert result["paymentMethodType"] == "pix"
    assert result["automaticRenewal"] is False
    assert result["qrCode"] == "000201-koma"
    assert result["qrCodeBase64"].startswith("iVBOR")
    assert result["amount"] == "129.00"


class _FakeRestaurantQuery:
    def __init__(self, restaurant):
        self.restaurant = restaurant

    def filter(self, *_args, **_kwargs):
        return self

    def one_or_none(self):
        return self.restaurant


class _FakeDb:
    def __init__(self, restaurant):
        self.restaurant = restaurant

    def query(self, _model):
        return _FakeRestaurantQuery(self.restaurant)


def test_saas_pix_uses_signed_legacy_billing_amount_after_catalog_changes(monkeypatch):
    db = _FakeDb(SimpleNamespace(id=10, plano="pro"))
    subscription = SaaSSubscription(
        restaurante_id=10,
        provider="mercado_pago",
        payment_method_type="pix",
        status="active",
        billing_cycle="monthly",
    )
    monkeypatch.setattr(
        saas_pix,
        "tenant_commercial_terms",
        lambda _db, _restaurant_id: SimpleNamespace(
            billing_amount=Decimal("209.00")
        ),
    )

    assert _subscription_amount(db, subscription, 10) == Decimal("209.00")


def test_saas_pix_legacy_without_acceptance_uses_frozen_v25_price(monkeypatch):
    db = _FakeDb(SimpleNamespace(id=11, plano="pro", billing_mode="legacy"))
    subscription = SaaSSubscription(
        restaurante_id=11,
        provider="mercado_pago",
        payment_method_type="pix",
        status="active",
        billing_cycle="monthly",
    )
    monkeypatch.setattr(
        saas_pix,
        "tenant_commercial_terms",
        lambda _db, _restaurant_id: None,
    )

    # O catálogo vigente é R$ 129, mas o fallback pré-aceite permanece R$ 209.
    assert _subscription_amount(db, subscription, 11) == Decimal("209.00")


def test_saas_pix_subscription_tenant_without_acceptance_fails_closed(monkeypatch):
    db = _FakeDb(
        SimpleNamespace(id=13, plano="pro", billing_mode="subscription")
    )
    subscription = SaaSSubscription(
        restaurante_id=13,
        provider="mercado_pago",
        payment_method_type="pix",
        status="active",
        billing_cycle="monthly",
    )
    monkeypatch.setattr(
        saas_pix,
        "tenant_commercial_terms",
        lambda _db, _restaurant_id: None,
    )

    with pytest.raises(HTTPException) as exc_info:
        _subscription_amount(db, subscription, 13)
    assert exc_info.value.status_code == 409
    assert "sem aceite comercial" in str(exc_info.value.detail)


@pytest.mark.parametrize(
    ("plan", "cycle", "signed_amount"),
    [
        ("pocket", "monthly", "39.00"),
        ("pocket", "annual", "421.20"),
        ("pro", "monthly", "129.00"),
        ("pro", "annual", "1393.20"),
        ("premium", "monthly", "249.00"),
        ("premium", "annual", "2689.20"),
    ],
)
def test_saas_pix_uses_signed_amount_for_each_new_plan_and_cycle(monkeypatch, plan, cycle, signed_amount):
    db = _FakeDb(SimpleNamespace(id=12, plano=plan))
    subscription = SaaSSubscription(
        restaurante_id=12,
        provider="mercado_pago",
        payment_method_type="pix",
        status="active",
        billing_cycle=cycle,
    )
    monkeypatch.setattr(
        saas_pix,
        "tenant_commercial_terms",
        lambda _db, _restaurant_id: SimpleNamespace(
            billing_amount=Decimal(signed_amount)
        ),
    )

    assert _subscription_amount(db, subscription, 12) == Decimal(signed_amount)


def test_approved_monthly_pix_advances_one_month_but_never_reactivates_canceled_subscription():
    paid_at = dt.datetime(2026, 10, 31, 12, 0, tzinfo=dt.timezone.utc)
    subscription = SaaSSubscription(
        restaurante_id=1,
        provider="mercado_pago",
        payment_method_type="pix",
        status="canceled",
        billing_cycle="monthly",
    )
    _advance_paid_period(subscription, paid_at)
    assert subscription.status == "canceled"
    assert subscription.current_period_end == dt.datetime(2026, 11, 30, 12, 0, tzinfo=dt.timezone.utc)


def test_approved_annual_pix_advances_twelve_months():
    paid_at = dt.datetime(2026, 10, 15, 8, 0, tzinfo=dt.timezone.utc)
    subscription = SaaSSubscription(
        restaurante_id=1,
        provider="mercado_pago",
        payment_method_type="pix",
        status="past_due",
        billing_cycle="annual",
    )
    _advance_paid_period(subscription, paid_at)
    assert subscription.status == "active"
    assert subscription.current_period_end == dt.datetime(2027, 10, 15, 8, 0, tzinfo=dt.timezone.utc)
