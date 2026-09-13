from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.routes.saas_billing import SaasBillingSetupRequest
from app.services.saas_billing_policy import (
    RECURRING_TRIAL_PAYMENT_METHODS,
    SAAS_TRIAL_DAYS,
    is_recurring_trial_payment_method,
)


def test_every_new_saas_payment_method_is_recurring_and_has_seven_day_trial():
    assert SAAS_TRIAL_DAYS == 7
    assert RECURRING_TRIAL_PAYMENT_METHODS == {"credit_card", "pix_automatic"}
    assert is_recurring_trial_payment_method("credit_card") is True
    assert is_recurring_trial_payment_method("pix_automatic") is True
    assert is_recurring_trial_payment_method("pix") is False


def test_upfront_pix_is_rejected_for_new_contracts():
    with pytest.raises(ValidationError) as exc:
        SaasBillingSetupRequest(payment_method_type="pix")
    message = str(exc.value)
    assert "Pix avulso antecipado foi removido" in message
    assert "pix_automatic" in message


def test_pix_automatic_does_not_require_card_token():
    request = SaasBillingSetupRequest(
        payment_method_type="pix_automatic",
        payer_email="buyer@example.test",
    )
    assert request.payment_method_type == "pix_automatic"
    assert request.card_token_id is None


def test_card_remains_a_recurring_authorization_method():
    request = SaasBillingSetupRequest(
        payment_method_type="credit_card",
        card_token_id="tok_test",
    )
    assert request.payment_method_type == "credit_card"
    assert request.card_token_id == "tok_test"
