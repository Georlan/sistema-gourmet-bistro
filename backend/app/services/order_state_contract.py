"""Contrato público canônico do estado de pedidos.

A camada HTTP pode continuar expondo campos legados durante a migração, mas
frontends novos devem consumir ``state`` em vez de reinterpretar strings livres.
"""

from __future__ import annotations

from ..domain.orders.types import (
    FulfillmentType,
    OrderStatus,
    normalize_to_fulfillment,
    normalize_to_order_status,
)

_TERMINAL = {OrderStatus.COMPLETED, OrderStatus.REJECTED, OrderStatus.CANCELLED}
_REJECTED = {OrderStatus.REJECTED, OrderStatus.CANCELLED}


def _base_phase(status: OrderStatus) -> str:
    return {
        OrderStatus.PENDING: "received",
        OrderStatus.ACCEPTED: "preparing",
        OrderStatus.PREPARING: "preparing",
        OrderStatus.READY: "ready",
        OrderStatus.DISPATCHED: "dispatched",
        OrderStatus.COMPLETED: "completed",
        OrderStatus.REJECTED: "rejected",
        OrderStatus.CANCELLED: "cancelled",
    }[status]


def _label(phase: str) -> str:
    return {
        "payment_pending": "Aguardando pagamento",
        "scheduled": "Pedido agendado",
        "received": "Aguardando aceite",
        "preparing": "Em preparo",
        "ready": "Pronto",
        "dispatched": "Saiu para entrega",
        "completed": "Concluído",
        "rejected": "Pedido não aceito",
        "cancelled": "Pedido cancelado",
    }[phase]


def _progress(phase: str, fulfillment: FulfillmentType) -> tuple[int, int]:
    total = 5 if fulfillment == FulfillmentType.DELIVERY else 4
    if phase in {"rejected", "cancelled"}:
        return 0, total
    if phase in {"payment_pending", "scheduled", "received"}:
        return 1, total
    if phase == "preparing":
        return 2, total
    if phase == "ready":
        return 3, total
    if phase == "dispatched":
        return (4 if fulfillment == FulfillmentType.DELIVERY else 3), total
    return total, total


def build_order_state_contract(
    status_value: str | OrderStatus | None,
    fulfillment_value: str | FulfillmentType | None,
    *,
    conversation_closed: bool = False,
    scheduled_pending: bool = False,
    payment_pending: bool = False,
) -> dict:
    """Retorna o contrato estável usado pelo Cardápio e pelo chat do pedido."""
    canonical_status = normalize_to_order_status(status_value)
    fulfillment = normalize_to_fulfillment(fulfillment_value)
    terminal = canonical_status in _TERMINAL
    rejected = canonical_status in _REJECTED

    if terminal:
        phase = _base_phase(canonical_status)
    elif payment_pending:
        phase = "payment_pending"
    elif scheduled_pending:
        phase = "scheduled"
    else:
        phase = _base_phase(canonical_status)

    progress_step, progress_total = _progress(phase, fulfillment)
    return {
        "status": canonical_status.value,
        "phase": phase,
        "label": _label(phase),
        "fulfillment": fulfillment.value,
        "terminal": terminal,
        "rejected": rejected,
        "can_chat": not terminal and not conversation_closed,
        # Ainda não existe endpoint público de cancelamento; não anuncie uma
        # capacidade que o cliente não consegue executar com segurança.
        "can_cancel": False,
        "progress_step": progress_step,
        "progress_total": progress_total,
    }
