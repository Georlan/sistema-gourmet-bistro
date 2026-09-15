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
    assert CHECKOUT_PAYMENT_METHODS == {"credit_card", "pix", "account_money"}
    assert TRIAL_ELIGIBLE_PAYMENT_METHODS == CHECKOUT_PAYMENT_METHODS
    for method in CHECKOUT_PAYMENT_METHODS:
        assert is_checkout_payment_method(method) is True
        assert is_trial_eligible_payment_method(method) is True


def test_only_card_and_balance_are_provider_recurring_in_new_checkout():
    assert RECURRING_TRIAL_PAYMENT_METHODS == {"credit_card", "pix_automatic", "account_money"}
    assert is_recurring_trial_payment_method("credit_card") is True
    assert is_recurring_trial_payment_method("account_money") is True
    assert is_recurring_trial_payment_method("pix") is False
    # legado mantido apenas para reconciliação de tentativas já existentes
    assert is_recurring_trial_payment_method("pix_automatic") is True
    assert is_checkout_payment_method("pix_automatic") is False


def test_legacy_recurring_setup_endpoint_still_rejects_plain_pix():
    # Pix universal usa /billing/pix/select e nunca cria pagamento no aceite.
    with pytest.raises(ValidationError):
        SaasBillingSetupRequest(payment_method_type="pix")


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
