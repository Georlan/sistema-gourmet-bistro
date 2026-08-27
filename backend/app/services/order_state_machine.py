"""Máquina de estados canônica para delivery e retirada."""

from __future__ import annotations

from dataclasses import dataclass


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


def allowed_order_targets(current_status: str | None, order_type: str | None) -> set[str]:
    current = normalize_order_status(current_status)
    kind = normalize_order_kind(order_type)

    if current == "pendente":
        return {"producao", "recusado"}
    if current == "producao":
        # Depois do aceite o restaurante ainda precisa conseguir cancelar por
        # indisponibilidade operacional; nesse caso o estoque já baixado é estornado.
        return {"pronto", "recusado"}
    if current == "pronto":
        if kind == "retirada":
            return {"finalizado", "recusado"}
        if kind == "delivery":
            return {"transito", "recusado"}
        return {"transito", "finalizado", "recusado"}
    if current == "transito":
        return {"finalizado", "recusado"} if kind != "retirada" else {"recusado"}
    return set()


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
        raise InvalidOrderTransition(current, target, allowed_order_targets(current, order_type))

    if current == target:
        return OrderTransition(
            current=current,
            target=target,
            order_kind=kind,
            changed=False,
            first_accept=False,
            terminal=target in {"finalizado", "recusado"},
        )

    allowed = allowed_order_targets(current, order_type)
    if target not in allowed:
        raise InvalidOrderTransition(current, target, allowed)

    return OrderTransition(
        current=current,
        target=target,
        order_kind=kind,
        changed=True,
        first_accept=current == "pendente" and target == "producao",
        terminal=target in {"finalizado", "recusado"},
    )
