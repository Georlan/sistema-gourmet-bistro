"""Compatibilidade legada para a máquina de estados de Pedidos.

As regras de transição pertencem a ``domain.orders.state_machine``. Este módulo
mantém somente o contrato histórico em português usado por rotas/testes antigos
e traduz entradas/saídas para o domínio canônico.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..domain.orders.errors import InvalidOrderTransitionError
from ..domain.orders.state_machine import OrderStateMachine
from ..domain.orders.types import (
    FulfillmentType,
    normalize_to_order_status,
    to_legacy_order_status,
)


CANONICAL_ORDER_STATUSES = frozenset({
    "pendente",
    "producao",
    "pronto",
    "transito",
    "finalizado",
    "recusado",
})

_STATUS_ALIASES = {
    "analise": "pendente",
    "recebido": "pendente",
    "preparando": "producao",
    "em_preparo": "producao",
    "saiu_entrega": "transito",
    "entregue": "finalizado",
    "cancelado": "recusado",
}

_DELIVERY_TYPES = {"delivery", "entrega"}
_PICKUP_TYPES = {"retirada", "viagem", "balcao", "balcão"}


class InvalidOrderTransition(ValueError):
    def __init__(
        self,
        current: str,
        target: str,
        allowed: set[str] | frozenset[str],
    ) -> None:
        self.current = current
        self.target = target
        self.allowed = tuple(sorted(allowed))
        allowed_text = ", ".join(self.allowed) if self.allowed else "nenhum"
        super().__init__(
            f"Transição de status inválida: {current} → {target}. "
            f"Próximos status permitidos: {allowed_text}."
        )


@dataclass(frozen=True)
class OrderTransition:
    current: str
    target: str
    order_kind: str
    changed: bool
    first_accept: bool
    terminal: bool


def normalize_order_status(value: str | None) -> str:
    normalized = (value or "pendente").strip().casefold()
    return _STATUS_ALIASES.get(normalized, normalized)


def normalize_order_kind(value: str | None) -> str:
    normalized = (value or "").strip().casefold()
    if normalized in _DELIVERY_TYPES:
        return "delivery"
    if normalized in _PICKUP_TYPES:
        return "retirada"
    return "desconhecido"


def _fulfillment_from_legacy_kind(kind: str) -> FulfillmentType:
    if kind == "delivery":
        return FulfillmentType.DELIVERY
    if kind == "retirada":
        return FulfillmentType.PICKUP
    # Historicamente tipos desconhecidos usavam o ramo mais permissivo de
    # pronto/transito. DINE_IN preserva exatamente esse comportamento no Core.
    return FulfillmentType.DINE_IN


def allowed_order_targets(current_status: str | None, order_type: str | None) -> set[str]:
    current = normalize_order_status(current_status)
    if current not in CANONICAL_ORDER_STATUSES:
        return set()

    kind = normalize_order_kind(order_type)
    allowed = OrderStateMachine.get_allowed_targets(
        normalize_to_order_status(current),
        _fulfillment_from_legacy_kind(kind),
    )
    return {to_legacy_order_status(status) for status in allowed}


def validate_order_transition(
    current_status: str | None,
    target_status: str,
    order_type: str | None,
) -> OrderTransition:
    current = normalize_order_status(current_status)
    target = normalize_order_status(target_status)
    kind = normalize_order_kind(order_type)

    if current not in CANONICAL_ORDER_STATUSES:
        raise InvalidOrderTransition(current, target, set())
    if target not in CANONICAL_ORDER_STATUSES:
        raise InvalidOrderTransition(
            current,
            target,
            allowed_order_targets(current, order_type),
        )

    try:
        result = OrderStateMachine.validate_transition(
            current_status=normalize_to_order_status(current),
            target_status=normalize_to_order_status(target),
            fulfillment=_fulfillment_from_legacy_kind(kind),
        )
    except InvalidOrderTransitionError as exc:
        raise InvalidOrderTransition(
            current,
            target,
            allowed_order_targets(current, order_type),
        ) from exc

    return OrderTransition(
        current=current,
        target=target,
        order_kind=kind,
        changed=result.changed,
        first_accept=result.first_accept,
        terminal=result.is_terminal,
    )
