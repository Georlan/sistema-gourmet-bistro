from __future__ import annotations

import datetime as dt
from decimal import Decimal

from app.routes.saas_pix import _advance_paid_period, _payment_qr_payload, _pix_reference
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
    result = _payment_qr_payload(payment, due_at=due, amount=Decimal("209.00"))
    assert result["paymentMethodType"] == "pix"
    assert result["automaticRenewal"] is False
    assert result["qrCode"] == "000201-koma"
    assert result["qrCodeBase64"].startswith("iVBOR")
    assert result["amount"] == "209.00"


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
