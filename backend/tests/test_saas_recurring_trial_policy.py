from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.routes.saas_billing import SaasBillingSetupRequest
from app.services.saas_billing_policy import (
    CHECKOUT_PAYMENT_METHODS,
    RECURRING_TRIAL_PAYMENT_METHODS,
    SAAS_TRIAL_DAYS,
    TRIAL_ELIGIBLE_PAYMENT_METHODS,
    is_checkout_payment_method,
    is_recurring_trial_payment_method,
    is_trial_eligible_payment_method,
)


def test_checkout_has_exactly_three_methods_and_preserves_trial():
    assert SAAS_TRIAL_DAYS == 7
    assert CHECKOUT_PAYMENT_METHODS == {"credit_card", "pix_automatic", "account_money"}
    assert TRIAL_ELIGIBLE_PAYMENT_METHODS == CHECKOUT_PAYMENT_METHODS
    for method in CHECKOUT_PAYMENT_METHODS:
        assert is_checkout_payment_method(method) is True
        assert is_trial_eligible_payment_method(method) is True


def test_all_checkout_methods_are_provider_recurring():
    assert RECURRING_TRIAL_PAYMENT_METHODS == CHECKOUT_PAYMENT_METHODS
    assert is_recurring_trial_payment_method("credit_card") is True
    assert is_recurring_trial_payment_method("pix_automatic") is True
    assert is_recurring_trial_payment_method("account_money") is True
    assert is_recurring_trial_payment_method("pix") is False
    assert is_checkout_payment_method("pix_automatic") is True
    assert is_checkout_payment_method("pix") is False


def test_recurring_setup_rejects_plain_pix_but_accepts_pix_automatic():
    with pytest.raises(ValidationError):
        SaasBillingSetupRequest(payment_method_type="pix")

    request = SaasBillingSetupRequest(
        payment_method_type="pix_automatic",
        payer_email="buyer@example.test",
    )
    assert request.payment_method_type == "pix_automatic"
    assert request.card_token_id is None


def test_account_money_does_not_require_card_token():
    request = SaasBillingSetupRequest(
        payment_method_type="account_money",
        payer_email="buyer@example.test",
    )
    assert request.payment_method_type == "account_money"
    assert request.card_token_id is None


def test_card_remains_a_recurring_authorization_method():
    request = SaasBillingSetupRequest(
        payment_method_type="credit_card",
        card_token_id="tok_test",
    )
    assert request.payment_method_type == "credit_card"
    assert request.card_token_id == "tok_test"
