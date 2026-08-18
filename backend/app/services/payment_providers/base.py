from dataclasses import dataclass
from decimal import Decimal
from enum import Enum
from typing import Protocol


class ProviderOutcome(str, Enum):
    APPROVED = "approved"
    DECLINED = "declined"
    PENDING = "pending"
    TIMEOUT = "timeout"
    ERROR = "error"


@dataclass(frozen=True)
class PaymentProviderCapabilities:
    methods: frozenset[str]
    supports_status_query: bool = True
    supports_cancel: bool = False


@dataclass(frozen=True)
class PaymentProviderRequest:
    intent_id: str
    restaurante_id: int
    terminal_id: str
    operation_key: str
    amount: Decimal
    method: str


@dataclass(frozen=True)
class PaymentProviderResult:
    outcome: ProviderOutcome
    reference: str | None = None
    message: str | None = None


class PaymentProvider(Protocol):
    name: str

    def capabilities(self) -> PaymentProviderCapabilities: ...

    def execute(self, request: PaymentProviderRequest) -> PaymentProviderResult:
        """Executa ou reconcilia a mesma operação de forma idempotente.

        Implementações reais não podem iniciar uma segunda cobrança quando
        recebem novamente a mesma operation_key. Se o SDK do adquirente não
        oferecer idempotência nativa, o adapter/bridge deve persistir a relação
        operation_key -> transação externa e reconciliar a operação existente.
        """
        ...
