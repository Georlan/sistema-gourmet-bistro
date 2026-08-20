import os

from .base import PaymentProvider
from .pagbank_simulator import PagBankSimulatorProvider


class ProviderUnavailable(RuntimeError):
    pass


def configured_provider_name() -> str:
    return os.getenv("KOMA_SMARTPOS_PROVIDER", "disabled").strip().lower()


def integrated_provider_available() -> bool:
    """True only for an adapter that is safe in the current environment.

    The only adapter implemented today is a simulator. Keeping it disabled in
    production prevents a DEV Android build from turning a fake approval into
    a real financial settlement.
    """
    environment = os.getenv("ENVIRONMENT", "production").strip().lower()
    return (
        configured_provider_name() == "pagbank_simulator"
        and environment in {"development", "test"}
    )


def terminal_mode() -> str:
    return "simulator" if integrated_provider_available() else "disabled"


def get_configured_provider() -> PaymentProvider:
    provider_name = configured_provider_name()
    if provider_name == "pagbank_simulator" and integrated_provider_available():
        return PagBankSimulatorProvider()
    raise ProviderUnavailable(
        "Nenhum provider SmartPOS integrado está habilitado neste ambiente."
    )
