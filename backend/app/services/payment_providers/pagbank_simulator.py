import hashlib

from .base import (
    PaymentProviderCapabilities,
    PaymentProviderRequest,
    PaymentProviderResult,
    ProviderOutcome,
)


class PagBankSimulatorProvider:
    """Simulador determinístico do contrato PagBank.

    O resultado pode ser fixado no construtor para testes adversariais. Quando
    omitido, a operation_key define um resultado estável, o que permite repetir
    a chamada sem simular uma segunda cobrança.
    """

    name = "pagbank"

    def __init__(self, forced_outcome: ProviderOutcome | None = None):
        self._forced_outcome = forced_outcome

    def capabilities(self) -> PaymentProviderCapabilities:
        return PaymentProviderCapabilities(
            methods=frozenset({"pix", "debito", "credito", "voucher"}),
            supports_status_query=True,
            supports_cancel=False,
        )

    def execute(self, request: PaymentProviderRequest) -> PaymentProviderResult:
        if request.method not in self.capabilities().methods:
            return PaymentProviderResult(
                outcome=ProviderOutcome.ERROR,
                message="Método não suportado pelo provider PagBank.",
            )

        outcome = self._forced_outcome
        if outcome is None:
            digest = hashlib.sha256(request.operation_key.encode("utf-8")).digest()[0]
            outcome = ProviderOutcome.APPROVED if digest % 5 else ProviderOutcome.DECLINED

        reference = f"pbsim-{hashlib.sha256(request.operation_key.encode('utf-8')).hexdigest()[:20]}"
        messages = {
            ProviderOutcome.APPROVED: "Pagamento aprovado pelo simulador PagBank.",
            ProviderOutcome.DECLINED: "Pagamento recusado pelo simulador PagBank.",
            ProviderOutcome.PENDING: "Pagamento ainda pendente no simulador PagBank.",
            ProviderOutcome.TIMEOUT: "Timeout simulado na comunicação com PagBank.",
            ProviderOutcome.ERROR: "Erro simulado na comunicação com PagBank.",
        }
        return PaymentProviderResult(
            outcome=outcome,
            reference=reference if outcome in {ProviderOutcome.APPROVED, ProviderOutcome.DECLINED, ProviderOutcome.PENDING} else None,
            message=messages[outcome],
        )
