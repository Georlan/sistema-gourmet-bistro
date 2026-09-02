from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from app.application.orders.lifecycle import OrderLifecycleCoordinator
from app.database import SessionLocal
from app.domain.orders.types import FulfillmentType, OrderStatus
from app.models import Comanda, IntegrationOutbox, Lancamento
from tests.characterization.orders.fixtures import (
    CHAR_RESTAURANT_ID,
    char_client,
    char_setup,
)


BACKEND_ROOT = Path(__file__).resolve().parents[1]


def test_delivery_routes_do_not_write_order_lifecycle_directly():
    source = (BACKEND_ROOT / "app/routes/orders.py").read_text(encoding="utf-8")

    forbidden_writers = (
        "comanda.delivery_status =",
        "lanc.status =",
        "lancamento.status =",
        "item.status =",
        "consumir_estoque_dos_itens(",
        "estornar_estoque_dos_itens(",
    )
    found = [token for token in forbidden_writers if token in source]

    assert found == []
    assert "OrderLifecycleCoordinator.transition_check_status" in source
    assert "OrderApplicationService." not in source
    assert "validate_order_transition(" not in source
    assert "services.order_state_machine" not in source


def test_aggregate_lifecycle_preserves_each_launch_status_and_skips_replays():
    comanda = SimpleNamespace(
        lancamentos=[
            SimpleNamespace(id="launch-preparing", status="producao", timestamp=1),
            SimpleNamespace(id="launch-ready", status="pronto", timestamp=2),
            SimpleNamespace(id="launch-completed", status="finalizado", timestamp=3),
        ]
    )

    active = OrderLifecycleCoordinator._active_orders(comanda)
    assert active == [
        ("launch-preparing", OrderStatus.PREPARING),
        ("launch-ready", OrderStatus.READY),
    ]

    pending = OrderLifecycleCoordinator._pending_order_transitions(
        active,
        target_status=OrderStatus.READY,
        fulfillment=FulfillmentType.PICKUP,
    )

    # O lançamento já pronto não pode gerar um segundo OrderReady; o finalizado
    # nem participa mais do lote ativo.
    assert pending == [("launch-preparing", OrderStatus.PREPARING)]


def test_aggregate_rejection_chooses_reject_or_cancel_per_launch_status():
    active = [
        ("launch-pending", OrderStatus.PENDING),
        ("launch-preparing", OrderStatus.PREPARING),
    ]
    pending = OrderLifecycleCoordinator._pending_order_transitions(
        active,
        target_status=OrderStatus.REJECTED,
        fulfillment=FulfillmentType.DELIVERY,
    )
    assert pending == active

    with patch(
        "app.application.orders.lifecycle.OrderApplicationService.reject_order"
    ) as reject_order, patch(
        "app.application.orders.lifecycle.OrderApplicationService.cancel_order"
    ) as cancel_order:
        for order_id, current_status in pending:
            OrderLifecycleCoordinator._apply_single_transition(
                object(),
                restaurant_id=CHAR_RESTAURANT_ID,
                order_id=order_id,
                current_status=current_status,
                target_status=OrderStatus.REJECTED,
                operator_user_id="operator-test",
                courier_id=None,
                reason="indisponibilidade",
            )

    assert reject_order.call_count == 1
    assert cancel_order.call_count == 1
    assert reject_order.call_args.args[1].order_id == "launch-pending"
    assert cancel_order.call_args.args[1].order_id == "launch-preparing"


def _clear_outbox() -> None:
    db = SessionLocal(restaurante_id=CHAR_RESTAURANT_ID)
    try:
        db.query(IntegrationOutbox).filter(
            IntegrationOutbox.restaurante_id == CHAR_RESTAURANT_ID
        ).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


def _event_names_for_check(comanda_id: str) -> list[str]:
    db = SessionLocal(restaurante_id=CHAR_RESTAURANT_ID)
    try:
        events = (
            db.query(IntegrationOutbox)
            .filter(IntegrationOutbox.restaurante_id == CHAR_RESTAURANT_ID)
            .order_by(IntegrationOutbox.created_at.asc(), IntegrationOutbox.id.asc())
            .all()
        )
        return [
            event.event_name
            for event in events
            if str((event.payload or {}).get("check_id") or "") == comanda_id
        ]
    finally:
        db.close()


def _create_pickup(char_client, *, phone: str, customer_name: str) -> str:
    created = char_client.post(
        "/cardapio/pedidos",
        json={
            "restaurante_id": CHAR_RESTAURANT_ID,
            "cliente_nome": customer_name,
            "cliente_telefone": phone,
            "tipo_pedido": "retirada",
            "itens": [
                {
                    "produto_id": "prod-char-simples",
                    "quantidade": 1,
                    "modificador_ids": [],
                }
            ],
        },
    )
    assert created.status_code in {200, 201}, created.text
    return created.json()["comanda_id"]


@patch("app.routes.cardapio._enforce_public_order_rate_limits", lambda *args, **kwargs: None)
@patch("app.services.whatsapp.enviar_notificacao_whatsapp_task", lambda *args, **kwargs: None)
def test_http_status_route_emits_canonical_lifecycle_events(char_client, char_setup):
    _clear_outbox()
    headers = char_setup["headers"]
    comanda_id = _create_pickup(
        char_client,
        phone="11977770001",
        customer_name="Lifecycle Authority",
    )

    accepted = char_client.put(
        f"/comandas/{comanda_id}/delivery/status",
        params={"status_novo": "producao"},
        headers=headers,
    )
    assert accepted.status_code == 200, accepted.text

    ready = char_client.put(
        f"/comandas/{comanda_id}/delivery/status",
        params={"status_novo": "pronto"},
        headers=headers,
    )
    assert ready.status_code == 200, ready.text

    completed = char_client.put(
        f"/comandas/{comanda_id}/delivery/status",
        params={"status_novo": "finalizado"},
        headers=headers,
    )
    assert completed.status_code == 200, completed.text
    assert completed.json()["delivery_status"] == "finalizado"
    assert completed.json()["fechada"] is True

    names = _event_names_for_check(comanda_id)
    assert names == [
        "koma.order.created",
        "koma.order.accepted",
        "koma.order.ready",
        "koma.order.completed",
    ]

    db = SessionLocal(restaurante_id=CHAR_RESTAURANT_ID)
    try:
        comanda = db.query(Comanda).filter(
            Comanda.restaurante_id == CHAR_RESTAURANT_ID,
            Comanda.id == comanda_id,
        ).one()
        launches = db.query(Lancamento).filter(
            Lancamento.restaurante_id == CHAR_RESTAURANT_ID,
            Lancamento.comanda_id == comanda_id,
        ).all()
        assert comanda.delivery_status == "finalizado"
        assert comanda.fechada is True
        assert launches
        assert all(launch.status == "finalizado" for launch in launches)
    finally:
        db.close()


@patch("app.routes.cardapio._enforce_public_order_rate_limits", lambda *args, **kwargs: None)
@patch("app.services.whatsapp.enviar_notificacao_whatsapp_task", lambda *args, **kwargs: None)
def test_pending_rejection_uses_rejected_event(char_client, char_setup):
    _clear_outbox()
    comanda_id = _create_pickup(
        char_client,
        phone="11977770003",
        customer_name="Lifecycle Reject",
    )

    rejected = char_client.put(
        f"/comandas/{comanda_id}/delivery/status",
        params={"status_novo": "recusado"},
        headers=char_setup["headers"],
    )
    assert rejected.status_code == 200, rejected.text
    assert rejected.json()["delivery_status"] == "recusado"
    assert rejected.json()["fechada"] is True
    assert _event_names_for_check(comanda_id) == [
        "koma.order.created",
        "koma.order.rejected",
    ]


@patch("app.routes.cardapio._enforce_public_order_rate_limits", lambda *args, **kwargs: None)
@patch("app.services.whatsapp.enviar_notificacao_whatsapp_task", lambda *args, **kwargs: None)
def test_operational_rejection_after_acceptance_uses_cancel_event(char_client, char_setup):
    _clear_outbox()
    headers = char_setup["headers"]
    comanda_id = _create_pickup(
        char_client,
        phone="11977770002",
        customer_name="Lifecycle Cancel",
    )

    accepted = char_client.put(
        f"/comandas/{comanda_id}/delivery/status",
        params={"status_novo": "producao"},
        headers=headers,
    )
    assert accepted.status_code == 200, accepted.text

    cancelled = char_client.put(
        f"/comandas/{comanda_id}/delivery/status",
        params={"status_novo": "recusado"},
        headers=headers,
    )
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["delivery_status"] == "recusado"
    assert cancelled.json()["fechada"] is True

    names = _event_names_for_check(comanda_id)
    assert names == [
        "koma.order.created",
        "koma.order.accepted",
        "koma.order.cancelled",
    ]