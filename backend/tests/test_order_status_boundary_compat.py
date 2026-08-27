from types import SimpleNamespace

import pytest

from app.routes.orders import _normalize_legacy_progress_target
from app.services.order_state_machine import InvalidOrderTransition, validate_order_transition


@pytest.mark.parametrize("order_type", ["Retirada", "Delivery"])
def test_legacy_transito_from_producao_is_mapped_to_pronto(order_type):
    order = SimpleNamespace(delivery_status="producao", tipo=order_type)

    target = _normalize_legacy_progress_target(order, "transito")

    assert target == "pronto"
    transition = validate_order_transition(order.delivery_status, target, order.tipo)
    assert transition.current == "producao"
    assert transition.target == "pronto"
    assert transition.changed is True


def test_real_delivery_dispatch_from_pronto_is_not_rewritten():
    order = SimpleNamespace(delivery_status="pronto", tipo="Delivery")

    target = _normalize_legacy_progress_target(order, "transito")

    assert target == "transito"
    transition = validate_order_transition(order.delivery_status, target, order.tipo)
    assert transition.target == "transito"


def test_pickup_still_cannot_enter_transito_after_it_is_pronto():
    order = SimpleNamespace(delivery_status="pronto", tipo="Retirada")

    target = _normalize_legacy_progress_target(order, "transito")

    assert target == "transito"
    with pytest.raises(InvalidOrderTransition):
        validate_order_transition(order.delivery_status, target, order.tipo)


def test_pending_order_cannot_skip_directly_to_transito():
    order = SimpleNamespace(delivery_status="pendente", tipo="Delivery")

    target = _normalize_legacy_progress_target(order, "transito")

    assert target == "transito"
    with pytest.raises(InvalidOrderTransition):
        validate_order_transition(order.delivery_status, target, order.tipo)
