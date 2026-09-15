from __future__ import annotations

from dataclasses import dataclass

from ..fiscal_models import FISCAL_DOCUMENT_STATUSES


class InvalidFiscalTransition(RuntimeError):
    pass


ALLOWED_FISCAL_TRANSITIONS: dict[str, frozenset[str]] = {
    "draft": frozenset({"ready"}),
    "ready": frozenset({"submitting", "contingency"}),
    "submitting": frozenset({"authorized", "rejected", "unknown", "contingency"}),
    "unknown": frozenset({"reconciling"}),
    "reconciling": frozenset({"authorized", "rejected", "unknown", "contingency"}),
    "contingency": frozenset({"pending_transmission"}),
    "pending_transmission": frozenset({"submitting", "reconciling", "authorized", "rejected"}),
    "authorized": frozenset({"cancel_pending"}),
    "cancel_pending": frozenset({"cancelled", "authorized"}),
    "rejected": frozenset(),
    "cancelled": frozenset(),
}


@dataclass(frozen=True)
class FiscalTransition:
    from_status: str
    to_status: str


def validate_fiscal_transition(from_status: str, to_status: str) -> FiscalTransition:
    known = set(FISCAL_DOCUMENT_STATUSES)
    if from_status not in known:
        raise InvalidFiscalTransition(f"Estado fiscal de origem desconhecido: {from_status}")
    if to_status not in known:
        raise InvalidFiscalTransition(f"Estado fiscal de destino desconhecido: {to_status}")
    if from_status == to_status:
        raise InvalidFiscalTransition(
            f"Transição fiscal redundante não permitida: {from_status} -> {to_status}"
        )
    if to_status not in ALLOWED_FISCAL_TRANSITIONS[from_status]:
        raise InvalidFiscalTransition(
            f"Transição fiscal inválida: {from_status} -> {to_status}"
        )
    return FiscalTransition(from_status=from_status, to_status=to_status)


def next_fiscal_statuses(status: str) -> frozenset[str]:
    if status not in ALLOWED_FISCAL_TRANSITIONS:
        raise InvalidFiscalTransition(f"Estado fiscal desconhecido: {status}")
    return ALLOWED_FISCAL_TRANSITIONS[status]
