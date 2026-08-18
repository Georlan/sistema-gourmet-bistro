import os

from .base import PaymentProvider
from .pagbank_simulator import PagBankSimulatorProvider


class ProviderUnavailable(RuntimeError):
    pass


def get_configured_provider() -> PaymentProvider:
    provider_name = os.getenv("KOMA_SMARTPOS_PROVIDER", "disabled").strip().lower()
    if provider_name == "pagbank_simulator":
        return PagBankSimulatorProvider()
    raise ProviderUnavailable(
        "Nenhum provider SmartPOS integrado está habilitado neste ambiente."
    )
