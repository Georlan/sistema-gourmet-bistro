from types import SimpleNamespace

import pytest

from app.services.online_payments.mercado_pago import MercadoPagoProvider
from app.services.online_payments.provider_registry import (
    UnsupportedPaymentProviderError,
    provider_for_account,
)


def test_provider_registry_resolves_mercado_pago_without_network():
    account = SimpleNamespace(provider="mercado_pago", access_token="test-token")

    provider = provider_for_account(account)

    assert isinstance(provider, MercadoPagoProvider)
    provider._client.close()


def test_provider_registry_fails_closed_for_unimplemented_provider():
    account = SimpleNamespace(provider="c6", access_token="unused")

    with pytest.raises(UnsupportedPaymentProviderError, match="c6"):
        provider_for_account(account)
