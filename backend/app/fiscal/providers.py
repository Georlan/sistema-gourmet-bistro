"""Provider-neutral boundary. Adapters own transport, never KÔMA sale/numbering policy.

Registration is server code only. Readiness must use local persisted evidence,
not perform requests during preflight. No provider is installed by default.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Literal, Protocol

FiscalEnvironment = Literal["homologacao", "producao"]
ProviderStatus = Literal["authorized", "rejected", "unknown", "contingency", "cancelled"]


@dataclass(frozen=True)
class FiscalProviderContext:
    restaurante_id: int
    environment: FiscalEnvironment
    model: str

    def __post_init__(self):
        if type(self.restaurante_id) is not int or self.restaurante_id <= 0 or self.environment not in {"homologacao", "producao"} or self.model not in {"55", "65"}:
            raise ValueError("Contexto fiscal inválido.")


@dataclass(frozen=True)
class FiscalProviderReadiness:
    configured: bool = False
    homologated: bool = False
    operations: frozenset[str] = frozenset()

    def __post_init__(self):
        if type(self.configured) is not bool or type(self.homologated) is not bool:
            raise ValueError("Readiness exige evidência booleana explícita.")
        if not isinstance(self.operations, frozenset):
            raise ValueError("Capabilities devem ser imutáveis.")

    @property
    def ready(self) -> bool:
        return self.configured and self.homologated and {"submit", "query", "cancel", "invalidate"}.issubset(self.operations)


@dataclass(frozen=True)
class FiscalProviderRequest:
    context: FiscalProviderContext
    document_id: str
    operation_key: str
    series: int
    number: int
    # Serialized snapshots are immutable and contain no connection credentials.
    sale_json: str = field(repr=False)
    calculation_json: str = field(repr=False)
    rule_set_version: str
    contract_version: str = "koma-fiscal-v1"
    source_status: str = "ready"

    def __post_init__(self):
        if not self.document_id or not self.operation_key or type(self.series) is not int or type(self.number) is not int or self.series <= 0 or self.number <= 0 or not self.rule_set_version:
            raise ValueError("Documento, numeração e versão tributária são obrigatórios.")
        if self.contract_version != "koma-fiscal-v1":
            raise ValueError("Versão do contrato fiscal não suportada.")
        for snapshot in (self.sale_json, self.calculation_json):
            try:
                parsed = json.loads(snapshot)
                if not isinstance(parsed, dict) or not parsed:
                    raise ValueError()
                json.dumps(parsed, allow_nan=False)
            except (ValueError, TypeError):
                raise ValueError("Snapshot fiscal deve ser um objeto não vazio e finito.") from None

    @property
    def fingerprint(self) -> str:
        payload = {
            "contract": self.contract_version, "tenant": self.context.restaurante_id,
            "environment": self.context.environment, "model": self.context.model,
            "document": self.document_id, "operation": self.operation_key,
            "series": self.series, "number": self.number,
            "sale": json.loads(self.sale_json), "calculation": json.loads(self.calculation_json),
            "rules": self.rule_set_version,
        }
        return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


@dataclass(frozen=True)
class FiscalProviderResult:
    context: FiscalProviderContext
    document_id: str
    operation_key: str
    status: ProviderStatus
    access_key: str | None = None
    authorization_protocol: str | None = None
    authorized_xml_storage_ref: str | None = field(default=None, repr=False)
    rejection_code: str | None = None
    event_protocol: str | None = None

    def __post_init__(self):
        if self.status not in {"authorized", "rejected", "unknown", "contingency", "cancelled"}:
            raise ValueError("Estado externo não reconhecido; concilie antes de reenviar.")
        if self.status == "authorized" and not (self.access_key and self.authorization_protocol and self.authorized_xml_storage_ref):
            raise ValueError("Recibo da API não substitui chave, protocolo e XML autorizado.")
        if self.status == "cancelled" and not self.event_protocol:
            raise ValueError("Cancelamento exige protocolo do evento fiscal.")
        if self.status == "rejected" and not self.rejection_code:
            raise ValueError("Rejeição exige um código fiscal explícito.")


class FiscalProvider(Protocol):
    def readiness(self, context: FiscalProviderContext) -> FiscalProviderReadiness: ...
    def submit(self, request: FiscalProviderRequest) -> FiscalProviderResult: ...
    def query(self, request: FiscalProviderRequest) -> FiscalProviderResult: ...
    def cancel(self, request: FiscalProviderRequest, justification: str) -> FiscalProviderResult: ...
    def invalidate(self, context: FiscalProviderContext, *, year: int, series: int, first_number: int, last_number: int, justification: str) -> str: ...


class FiscalProviderRegistry:
    def __init__(self):
        self._adapters: dict[str, FiscalProvider] = {}

    def register(self, name: str, adapter: FiscalProvider) -> None:
        if not all(callable(getattr(adapter, operation, None)) for operation in ("readiness", "submit", "query", "cancel", "invalidate")):
            raise ValueError("Adapter fiscal não implementa o contrato completo.")
        if not name or name in self._adapters:
            raise ValueError("Provedor fiscal ausente ou já registrado.")
        self._adapters[name] = adapter

    def readiness(self, name: str, context: FiscalProviderContext) -> FiscalProviderReadiness:
        adapter = self._adapters.get(name)
        if adapter is None:
            return FiscalProviderReadiness()
        try:
            result = adapter.readiness(context)
            return result if isinstance(result, FiscalProviderReadiness) else FiscalProviderReadiness()
        except Exception:
            # Never expose third-party secrets/errors or turn an outage into readiness.
            return FiscalProviderReadiness()

    def query(self, name: str, request: FiscalProviderRequest) -> FiscalProviderResult:
        if not self.readiness(name, request.context).ready:
            raise ValueError("Integração fiscal ainda não configurada e homologada para consulta.")
        try:
            result = self._adapters[name].query(request)
        except Exception:
            return FiscalProviderResult(request.context, request.document_id, request.operation_key, "unknown")
        return self._validate_result(request, result)

    @staticmethod
    def _validate_result(request: FiscalProviderRequest, result: FiscalProviderResult) -> FiscalProviderResult:
        if (result.context, result.document_id, result.operation_key) != (request.context, request.document_id, request.operation_key):
            raise ValueError("Resposta fiscal pertence a outro documento, restaurante ou ambiente.")
        return result

    def submit(self, name: str, request: FiscalProviderRequest) -> FiscalProviderResult:
        if request.source_status not in {"ready", "pending_transmission"}:
            raise ValueError("Estado fiscal exige consulta/conciliação; não submeta novamente.")
        if not self.readiness(name, request.context).ready:
            raise ValueError("Integração fiscal ainda não configurada e homologada para este restaurante/ambiente.")
        try:
            result = self._adapters[name].submit(request)
        except Exception:
            # An exception may happen after an external side effect. Do not retry here.
            return FiscalProviderResult(request.context, request.document_id, request.operation_key, "unknown")
        return self._validate_result(request, result)


fiscal_providers = FiscalProviderRegistry()
