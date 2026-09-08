from app.routes.order_tracking import _effective_tracking_status
from app.services.order_state_contract import build_order_state_contract


def test_delivery_progress_and_terminal_flags_are_canonical():
    preparing = build_order_state_contract("producao", "Delivery")
    assert preparing == {
        "status": "preparing",
        "phase": "preparing",
        "label": "Em preparo",
        "fulfillment": "delivery",
        "terminal": False,
        "rejected": False,
        "can_chat": True,
        "can_cancel": False,
        "progress_step": 2,
        "progress_total": 5,
    }

    completed = build_order_state_contract("finalizado", "Delivery")
    assert completed["status"] == "completed"
    assert completed["phase"] == "completed"
    assert completed["terminal"] is True
    assert completed["can_chat"] is False
    assert completed["progress_step"] == 5
    assert completed["progress_total"] == 5


def test_rejected_and_cancelled_are_terminal_without_string_heuristics():
    rejected = build_order_state_contract("recusado", "Retirada")
    cancelled = build_order_state_contract("cancelado", "Retirada")

    assert rejected["status"] == "rejected"
    assert rejected["rejected"] is True
    assert rejected["terminal"] is True
    assert rejected["progress_step"] == 0

    assert cancelled["status"] == "cancelled"
    assert cancelled["rejected"] is True
    assert cancelled["terminal"] is True
    assert cancelled["progress_step"] == 0


def test_scheduled_and_payment_phases_override_only_non_terminal_orders():
    scheduled = build_order_state_contract(
        "pendente",
        "Retirada",
        scheduled_pending=True,
    )
    assert scheduled["phase"] == "scheduled"
    assert scheduled["label"] == "Pedido agendado"

    payment = build_order_state_contract(
        "pendente",
        "Retirada",
        payment_pending=True,
    )
    assert payment["phase"] == "payment_pending"
    assert payment["label"] == "Aguardando pagamento"

    completed = build_order_state_contract(
        "finalizado",
        "Retirada",
        scheduled_pending=True,
        payment_pending=True,
    )
    assert completed["phase"] == "completed"


def test_conversation_closed_disables_chat_even_while_order_is_active():
    state = build_order_state_contract(
        "pronto",
        "Retirada",
        conversation_closed=True,
    )
    assert state["status"] == "ready"
    assert state["terminal"] is False
    assert state["can_chat"] is False


def test_closed_tracking_forces_completed_without_overwriting_rejection():
    class Order:
        delivery_status = "producao"
        fechada = True

    order = Order()
    assert _effective_tracking_status(order) == "finalizado"

    order.delivery_status = "recusado"
    assert _effective_tracking_status(order) == "recusado"

    order.delivery_status = "cancelado"
    assert _effective_tracking_status(order) == "cancelado"
