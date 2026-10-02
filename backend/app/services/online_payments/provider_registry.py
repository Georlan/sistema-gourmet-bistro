from __future__ import annotations

from ...models import RestaurantPaymentAccount
from .base import OnlinePaymentProvider
from .mercado_pago import MercadoPagoProvider


class UnsupportedPaymentProviderError(RuntimeError):
    pass


def provider_for_account(account: RestaurantPaymentAccount) -> OnlinePaymentProvider:
    """Resolve o adaptador financeiro sem espalhar decisão de provider pelo domínio."""
    provider = str(account.provider or "").strip().lower()
    if provider == "mercado_pago":
        return MercadoPagoProvider(account.access_token)
    raise UnsupportedPaymentProviderError(
        f"Provedor de pagamento ainda não suportado: {provider or 'não informado'}."
    )
