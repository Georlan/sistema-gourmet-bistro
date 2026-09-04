from pathlib import Path

import pytest

from app.domain.orders.errors import InvalidOrderTransitionError
from app.domain.orders.state_machine import OrderStateMachine
from app.domain.orders.types import FulfillmentType, OrderStatus
from app.services.order_state_machine import (
    InvalidOrderTransition,
    allowed_order_targets,
    normalize_order_kind,
    normalize_order_status,
    validate_order_transition,
)


BACKEND_ROOT = Path(__file__).resolve().parents[2]


def test_domain_state_machine_is_the_dependency_owner():
    domain_source = (
        BACKEND_ROOT / "app/domain/orders/state_machine.py"
    ).read_text(encoding="utf-8")
    legacy_source = (
        BACKEND_ROOT / "app/services/order_state_machine.py"
    ).read_text(encoding="utf-8")

    assert "services.order_state_machine" not in domain_source
    assert "OrderStateMachine" in legacy_source
    assert "domain.orders.state_machine" in legacy_source

    # O shim pode normalizar strings antigas, mas não pode voltar a possuir a
    # tabela de transições que já pertence ao domínio.
    forbidden_legacy_rules = (
        'if current == "pendente"',
        'if current == "producao"',
        'if current == "pronto"',
        'if current == "transito"',
    )
    assert [rule for rule in forbidden_legacy_rules if rule in legacy_source] == []


@pytest.mark.parametrize(
    ("current", "order_type", "expected"),
    [
        (None, "delivery", {"producao", "recusado"}),
        ("producao", "delivery", {"pronto", "recusado"}),
        ("pronto", "delivery", {"transito", "recusado"}),
        ("pronto", "retirada", {"finalizado", "recusado"}),
        ("pronto", "mesa", {"transito", "finalizado", "recusado"}),
        ("transito", "delivery", {"finalizado", "recusado"}),
        ("transito", "retirada", {"recusado"}),
        ("finalizado", "delivery", set()),
        ("status_desconhecido", "delivery", set()),
    ],
)
def test_legacy_allowed_targets_contract_is_preserved(current, order_type, expected):
    assert allowed_order_targets(current, order_type) == expected


def test_legacy_normalization_contract_is_preserved():
    assert normalize_order_status("analise") == "pendente"
    assert normalize_order_status("recebido") == "pendente"
    assert normalize_order_status("preparando") == "producao"
    assert normalize_order_status("em_preparo") == "producao"
    assert normalize_order_status("saiu_entrega") == "transito"
    assert normalize_order_status("entregue") == "finalizado"
    assert normalize_order_status("cancelado") == "recusado"
    assert normalize_order_status("custom") == "custom"

    assert normalize_order_kind("entrega") == "delivery"
    assert normalize_order_kind("balcão") == "retirada"
    assert normalize_order_kind("mesa") == "desconhecido"


def test_legacy_transition_result_contract_is_preserved():
    accepted = validate_order_transition("pendente", "producao", "delivery")
    assert accepted.current == "pendente"
    assert accepted.target == "producao"
    assert accepted.order_kind == "delivery"
    assert accepted.changed is True
    assert accepted.first_accept is True
    assert accepted.terminal is False

    same_terminal = validate_order_transition("recusado", "cancelado", "delivery")
    assert same_terminal.current == "recusado"
    assert same_terminal.target == "recusado"
    assert same_terminal.changed is False
    assert same_terminal.terminal is True


def test_legacy_invalid_transition_keeps_old_error_shape():
    with pytest.raises(InvalidOrderTransition) as exc_info:
        validate_order_transition("pendente", "finalizado", "delivery")

    exc = exc_info.value
    assert exc.current == "pendente"
    assert exc.target == "finalizado"
    assert exc.allowed == ("producao", "recusado")
    assert "Transição de status inválida" in str(exc)


def test_canonical_cancel_intent_uses_rejection_edge_without_losing_semantics():
    transition = OrderStateMachine.validate_transition(
        current_status=OrderStatus.PREPARING,
        target_status=OrderStatus.CANCELLED,
        fulfillment=FulfillmentType.DELIVERY,
    )

    assert transition.target_status == OrderStatus.CANCELLED
    assert transition.changed is True
    assert transition.is_terminal is True


def test_canonical_accepted_alias_has_same_operational_targets_as_preparing():
    accepted_targets = OrderStateMachine.get_allowed_targets(
        OrderStatus.ACCEPTED,
        FulfillmentType.DELIVERY,
    )
    preparing_targets = OrderStateMachine.get_allowed_targets(
        OrderStatus.PREPARING,
        FulfillmentType.DELIVERY,
    )

    assert accepted_targets == preparing_targets == (
        OrderStatus.READY,
        OrderStatus.REJECTED,
    )


def test_canonical_invalid_transition_reports_canonical_allowed_targets():
    with pytest.raises(InvalidOrderTransitionError) as exc_info:
        OrderStateMachine.validate_transition(
            current_status=OrderStatus.PENDING,
            target_status=OrderStatus.COMPLETED,
            fulfillment=FulfillmentType.PICKUP,
        )

    exc = exc_info.value
    assert exc.current_status == "pending"
    assert exc.target_status == "completed"
    assert exc.allowed_targets == ("preparing", "rejected")
