"""Máquina de estados canônica do domínio de Pedidos.

Este módulo é o único owner das regras de transição. Camadas de compatibilidade
legadas podem adaptar strings antigas para ``OrderStatus``/``FulfillmentType``,
mas não devem manter uma segunda tabela de transições.
"""

from __future__ import annotations

from dataclasses import dataclass

from .errors import InvalidOrderTransitionError
from .types import (
    FulfillmentType,
    OrderStatus,
    normalize_to_fulfillment,
    normalize_to_order_status,
)


@dataclass(frozen=True)
class OrderTransitionResult:
    """Resultado canônico e imutável de uma transição de status."""

    current_status: OrderStatus
    target_status: OrderStatus
    fulfillment: FulfillmentType
    changed: bool
    first_accept: bool
    is_terminal: bool


def _effective_transition_status(status: OrderStatus) -> OrderStatus:
    """Colapsa aliases semânticos que persistem no mesmo estado legado.

    ``ACCEPTED`` e ``PREPARING`` compartilham ``producao`` no banco atual.
    ``CANCELLED`` e ``REJECTED`` compartilham ``recusado``. A API canônica pode
    distinguir a intenção/evento sem criar uma segunda aresta de transição.
    """

    if status == OrderStatus.ACCEPTED:
        return OrderStatus.PREPARING
    if status == OrderStatus.CANCELLED:
        return OrderStatus.REJECTED
    return status


class OrderStateMachine:
    """Autoridade única de transições de ciclo de vida dos pedidos KÔMA."""

    @staticmethod
    def get_allowed_targets(
        current_status: OrderStatus | str | None,
        fulfillment: FulfillmentType | str | None,
    ) -> tuple[OrderStatus, ...]:
        """Retorna os próximos estados públicos permitidos.

        Mantém o contrato histórico: cancelamento operacional é validado como a
        mesma aresta de recusa, portanto a lista pública continua expondo
        ``REJECTED`` e não duplica ``CANCELLED``.
        """

        current = _effective_transition_status(
            normalize_to_order_status(current_status)
        )
        kind = normalize_to_fulfillment(fulfillment)

        if current == OrderStatus.PENDING:
            allowed = {OrderStatus.PREPARING, OrderStatus.REJECTED}
        elif current == OrderStatus.PREPARING:
            allowed = {OrderStatus.READY, OrderStatus.REJECTED}
        elif current == OrderStatus.READY:
            if kind == FulfillmentType.PICKUP:
                allowed = {OrderStatus.COMPLETED, OrderStatus.REJECTED}
            elif kind == FulfillmentType.DELIVERY:
                allowed = {OrderStatus.DISPATCHED, OrderStatus.REJECTED}
            else:
                # Preserva o comportamento histórico do tipo não-delivery/pickup.
                allowed = {
                    OrderStatus.DISPATCHED,
                    OrderStatus.COMPLETED,
                    OrderStatus.REJECTED,
                }
        elif current == OrderStatus.DISPATCHED:
            if kind == FulfillmentType.PICKUP:
                allowed = {OrderStatus.REJECTED}
            else:
                allowed = {OrderStatus.COMPLETED, OrderStatus.REJECTED}
        else:
            allowed = set()

        return tuple(sorted(allowed, key=lambda item: item.value))

    @staticmethod
    def validate_transition(
        current_status: OrderStatus | str | None,
        target_status: OrderStatus | str,
        fulfillment: FulfillmentType | str | None,
    ) -> OrderTransitionResult:
        """Valida e descreve uma transição usando somente vocabulário canônico."""

        canonical_current = normalize_to_order_status(current_status)
        canonical_target = normalize_to_order_status(target_status)
        canonical_fulfillment = normalize_to_fulfillment(fulfillment)

        effective_current = _effective_transition_status(canonical_current)
        effective_target = _effective_transition_status(canonical_target)

        if effective_current == effective_target:
            return OrderTransitionResult(
                current_status=canonical_current,
                target_status=canonical_target,
                fulfillment=canonical_fulfillment,
                changed=False,
                first_accept=False,
                is_terminal=effective_target
                in {OrderStatus.COMPLETED, OrderStatus.REJECTED},
            )

        allowed = OrderStateMachine.get_allowed_targets(
            canonical_current,
            canonical_fulfillment,
        )
        effective_allowed = {
            _effective_transition_status(candidate) for candidate in allowed
        }
        if effective_target not in effective_allowed:
            raise InvalidOrderTransitionError(
                current_status=canonical_current.value,
                target_status=canonical_target.value,
                allowed_targets=tuple(item.value for item in allowed),
            )

        return OrderTransitionResult(
            current_status=canonical_current,
            target_status=canonical_target,
            fulfillment=canonical_fulfillment,
            changed=True,
            first_accept=(
                effective_current == OrderStatus.PENDING
                and effective_target == OrderStatus.PREPARING
            ),
            is_terminal=effective_target
            in {OrderStatus.COMPLETED, OrderStatus.REJECTED},
        )
