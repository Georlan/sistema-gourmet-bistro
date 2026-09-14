"""Pagamentos online com barreira de liberação operacional."""

# Importa as invariantes de identidade/fidelidade antes do serviço financeiro.
# Isso registra os listeners transacionais também em testes ou workers que
# importam apenas o pacote de pagamentos online, sem subir todas as rotas HTTP.
from .. import clientes as _customer_invariants  # noqa: F401
from .service import (
    OnlinePaymentConfigurationError,
    OnlinePaymentService,
    OnlinePaymentValidationError,
)

__all__ = [
    "OnlinePaymentConfigurationError",
    "OnlinePaymentService",
    "OnlinePaymentValidationError",
]
