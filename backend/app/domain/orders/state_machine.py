"""Encapsulamento e adaptação canônica da máquina de estados de pedidos.

Reutiliza diretamente o motor de transições de `order_state_machine.py`
garantindo 100% de equivalência entre legado e canônico.
"""

from __future__ import annotations

from dataclasses import dataclass
from ...services.order_state_machine import (
    allowed_order_targets as _legacy_allowed_targets,
    validate_order_transition as _legacy_validate_transition,
    InvalidOrderTransition as _LegacyInvalidTransition,
)
from .types import (
    FulfillmentType,
    OrderStatus,
    normalize_to_fulfillment,
    normalize_to_order_status,
    to_legacy_fulfillment,
    to_legacy_order_status,
)
from .errors import InvalidOrderTransitionError


@dataclass(frozen=True)
class OrderTransitionResult:
    """Resultado canônico e imutável de uma transição de status."""

    current_status: OrderStatus
    target_status: OrderStatus
    fulfillment: FulfillmentType
    changed: bool
    first_accept: bool
    is_terminal: bool


class OrderStateMachine:
    """Máquina de estados canônica do Kôma."""

    @staticmethod
    def get_allowed_targets(
        current_status: OrderStatus | str | None,
        fulfillment: FulfillmentType | str | None,
    ) -> tuple[OrderStatus, ...]:
        """Retorna os próximos OrderStatus permitidos a partir do estado atual."""
        canonical_current = normalize_to_order_status(current_status)
        canonical_fulfillment = normalize_to_fulfillment(fulfillment)

        legacy_current = to_legacy_order_status(canonical_current)
        legacy_kind = to_legacy_fulfillment(canonical_fulfillment)

        legacy_allowed = _legacy_allowed_targets(legacy_current, legacy_kind)
        return tuple(sorted({normalize_to_order_status(item) for item in legacy_allowed}, key=lambda s: s.value))

    @staticmethod
    def validate_transition(
        current_status: OrderStatus | str | None,
        target_status: OrderStatus | str,
        fulfillment: FulfillmentType | str | None,
    ) -> OrderTransitionResult:
        """Valida e computa a transição de status entre o estado atual e o alvo."""
        canonical_current = normalize_to_order_status(current_status)
        canonical_target = normalize_to_order_status(target_status)
        canonical_fulfillment = normalize_to_fulfillment(fulfillment)

        legacy_current = to_legacy_order_status(canonical_current)
        legacy_target = to_legacy_order_status(canonical_target)
        legacy_kind = to_legacy_fulfillment(canonical_fulfillment)

        try:
            res = _legacy_validate_transition(
                current_status=legacy_current,
                target_status=legacy_target,
                order_type=legacy_kind,
            )
            return OrderTransitionResult(
                current_status=canonical_current,
                target_status=canonical_target,
                fulfillment=canonical_fulfillment,
                changed=res.changed,
                first_accept=res.first_accept,
                is_terminal=res.terminal,
            )
        except _LegacyInvalidTransition as exc:
            allowed_canonical = tuple(
                sorted(
                    {normalize_to_order_status(t).value for t in exc.allowed}
                )
            )
            raise InvalidOrderTransitionError(
                current_status=canonical_current.value,
                target_status=canonical_target.value,
                allowed_targets=allowed_canonical,
            ) from exc
