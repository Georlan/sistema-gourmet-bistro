from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from decimal import Decimal

from app.application.orders.commands import CreateOrderCommand, CustomerInput, OrderItemInput
from app.application.orders.lifecycle import OrderLifecycleCoordinator
from app.application.orders.service import OrderApplicationService
from app.database import SessionLocal
from app.domain.orders.types import FulfillmentType, OrderChannel, OrderStatus
from app.models import Comanda, IntegrationOutbox, Item, Lancamento, Insumo
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
    assert "if current_status == target_status:" not in source


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


def test_aggregate_target_still_advances_a_lagging_launch():
    comanda = SimpleNamespace(
        id="check-mixed",
        delivery_status="pronto",
        tipo="retirada",
        lancamentos=[
            SimpleNamespace(id="launch-preparing", status="producao", timestamp=1),
            SimpleNamespace(id="launch-ready", status="pronto", timestamp=2),
        ],
    )

    class FakeQuery:
        def filter(self, *args):
            return self

        def with_for_update(self):
            return self

        def first(self):
            return comanda

    class FakeSession:
        def query(self, *args):
            return FakeQuery()

    with patch.object(
        OrderLifecycleCoordinator,
        "_apply_single_transition",
    ) as apply_transition, patch("app.services.order_chat_service.post_system_order_event"):
        result = OrderLifecycleCoordinator.transition_check_status(
            FakeSession(),
            restaurant_id=CHAR_RESTAURANT_ID,
            comanda_id=comanda.id,
            target_status="pronto",
            commit=False,
        )

    assert result.changed is True
    apply_transition.assert_called_once()
    assert apply_transition.call_args.kwargs["order_id"] == "launch-preparing"
    assert apply_transition.call_args.kwargs["current_status"] == OrderStatus.PREPARING


def test_aggregate_target_advances_comanda_status_when_all_launches_already_at_target():
    comanda = SimpleNamespace(
        id="check-all-preparing",
        delivery_status="pendente",
        tipo="Delivery",
        fechada=False,
        fechado_em=None,
        lancamentos=[
            SimpleNamespace(id="launch-already-preparing", status="producao", timestamp=1),
        ],
    )

    class FakeQuery:
        def filter(self, *args):
            return self

        def with_for_update(self):
            return self

        def first(self):
            return comanda

    class FakeSession:
        def query(self, *args):
            return FakeQuery()

    with patch.object(
        OrderLifecycleCoordinator,
        "_apply_single_transition",
    ) as apply_transition, patch("app.services.order_chat_service.post_system_order_event"):
        result = OrderLifecycleCoordinator.transition_check_status(
            FakeSession(),
            restaurant_id=CHAR_RESTAURANT_ID,
            comanda_id=comanda.id,
            target_status="producao",
            commit=False,
        )

    assert result.changed is True
    assert result.target_status == OrderStatus.PREPARING
    assert comanda.delivery_status == "producao"
    apply_transition.assert_not_called()


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


def _create_unseated_pos_dine_in() -> str:
    db = SessionLocal(restaurante_id=CHAR_RESTAURANT_ID)
    try:
        created = OrderApplicationService.create_order(
            db,
            CreateOrderCommand(
                restaurant_id=CHAR_RESTAURANT_ID,
                channel=OrderChannel.POS,
                fulfillment=FulfillmentType.DINE_IN,
                items=(
                    OrderItemInput(
                        product_id="prod-char-simples",
                        quantity=Decimal("1.00"),
                    ),
                ),
                customer=CustomerInput(
                    name="Cliente Local Caixa",
                    phone="11977770010",
                ),
            ),
        )
        return created.comanda_id
    finally:
        db.close()


def _create_internal_digital_dine_in() -> str:
    db = SessionLocal(restaurante_id=CHAR_RESTAURANT_ID)
    try:
        created = OrderApplicationService.create_order(
            db,
            CreateOrderCommand(
                restaurant_id=CHAR_RESTAURANT_ID,
                channel=OrderChannel.WEB_CARDAPIO,
                fulfillment=FulfillmentType.DINE_IN,
                items=(
                    OrderItemInput(
                        product_id="prod-char-simples",
                        quantity=Decimal("1.00"),
                    ),
                ),
                customer=CustomerInput(
                    name="Cliente Local Digital",
                    phone="11977770009",
                ),
            ),
        )
        return created.comanda_id
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


def test_unseated_pos_dine_in_uses_center_operational_lifecycle(char_client, char_setup):
    headers = char_setup["headers"]
    comanda_id = _create_unseated_pos_dine_in()

    active = char_client.get("/comandas/delivery/ativos", headers=headers)
    assert active.status_code == 200, active.text
    active_ids = {row["id"] for row in active.json()}
    assert comanda_id in active_ids

    ready = char_client.put(
        f"/comandas/{comanda_id}/delivery/status",
        params={"status_novo": "pronto"},
        headers=headers,
    )
    assert ready.status_code == 200, ready.text
    assert ready.json()["tipo"] == "Consumo no Local"
    assert ready.json()["delivery_status"] == "pronto"

    invalid_transit = char_client.put(
        f"/comandas/{comanda_id}/delivery/status",
        params={"status_novo": "transito"},
        headers=headers,
    )
    assert invalid_transit.status_code == 409, invalid_transit.text


def test_digital_dine_in_uses_active_digital_route_without_delivery_transit(char_client, char_setup):
    _clear_outbox()
    headers = char_setup["headers"]
    comanda_id = _create_internal_digital_dine_in()

    active = char_client.get("/comandas/delivery/ativos", headers=headers)
    assert active.status_code == 200, active.text
    active_ids = {row["id"] for row in active.json()}
    assert comanda_id in active_ids

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

    invalid_transit = char_client.put(
        f"/comandas/{comanda_id}/delivery/status",
        params={"status_novo": "transito"},
        headers=headers,
    )
    assert invalid_transit.status_code == 409, invalid_transit.text

    completed = char_client.put(
        f"/comandas/{comanda_id}/delivery/status",
        params={"status_novo": "finalizado"},
        headers=headers,
    )
    assert completed.status_code == 200, completed.text
    assert completed.json()["tipo"] == "Consumo no Local"
    assert completed.json()["delivery_status"] == "finalizado"
    assert completed.json()["fechada"] is True


@patch("app.routes.cardapio._enforce_public_order_rate_limits", lambda *args, **kwargs: None)
@patch("app.services.whatsapp.enviar_notificacao_whatsapp_task", lambda *args, **kwargs: None)
def test_item_ready_is_production_only_until_explicit_order_transition(char_client, char_setup):
    _clear_outbox()
    headers = char_setup["headers"]
    comanda_id = _create_pickup(
        char_client,
        phone="11977770011",
        customer_name="Kitchen State Separation",
    )

    accepted = char_client.put(
        f"/comandas/{comanda_id}/delivery/status",
        params={"status_novo": "producao"},
        headers=headers,
    )
    assert accepted.status_code == 200, accepted.text

    db = SessionLocal(restaurante_id=CHAR_RESTAURANT_ID)
    try:
        item_id = (
            db.query(Item.id)
            .filter(
                Item.restaurante_id == CHAR_RESTAURANT_ID,
                Item.comanda_id == comanda_id,
            )
            .scalar()
        )
        assert item_id
    finally:
        db.close()

    with patch("app.routes.orders_core._agendar_notificacao_whatsapp_status") as notify_ready:
        item_ready = char_client.put(
            f"/comandas/itens/{item_id}/status",
            params={"status": "pronto"},
            headers=headers,
        )

    assert item_ready.status_code == 200, item_ready.text
    notify_ready.assert_not_called()
    assert _event_names_for_check(comanda_id) == [
        "koma.order.created",
        "koma.order.accepted",
    ]

    db = SessionLocal(restaurante_id=CHAR_RESTAURANT_ID)
    try:
        comanda = db.query(Comanda).filter(
            Comanda.restaurante_id == CHAR_RESTAURANT_ID,
            Comanda.id == comanda_id,
        ).one()
        item = db.query(Item).filter(
            Item.restaurante_id == CHAR_RESTAURANT_ID,
            Item.id == item_id,
        ).one()
        assert item.status == "pronto"
        assert comanda.delivery_status == "producao"
    finally:
        db.close()


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
    with SessionLocal(restaurante_id=CHAR_RESTAURANT_ID) as db:
        stock_before = {row.id: row.estoque_atual for row in db.query(Insumo).all()}
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

    ready = char_client.put(
        f"/comandas/{comanda_id}/delivery/status",
        params={"status_novo": "pronto"},
        headers=headers,
    )
    assert ready.status_code == 200, ready.text
    reason = "Cliente desistiu da retirada"
    cancelled = char_client.put(
        f"/comandas/{comanda_id}/delivery/status",
        params={"status_novo": "recusado"},
        headers=headers,
        json={"reason": reason},
    )
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["delivery_status"] == "recusado"
    assert cancelled.json()["fechada"] is True

    names = _event_names_for_check(comanda_id)
    assert names == [
        "koma.order.created",
        "koma.order.accepted",
        "koma.order.ready",
        "koma.order.cancelled",
    ]

    with SessionLocal(restaurante_id=CHAR_RESTAURANT_ID) as db:
        events = db.query(IntegrationOutbox).filter(
            IntegrationOutbox.restaurante_id == CHAR_RESTAURANT_ID,
            IntegrationOutbox.event_name == "koma.order.cancelled",
        ).all()
        event = next(event for event in events if event.payload.get("check_id") == comanda_id)
        assert event.payload["reason"] == reason
        order = db.query(Comanda).filter(Comanda.id == comanda_id).one()
        assert order.valor_pago == 0
        assert all(item.status == "cancelado" for item in order.itens)
    replay = char_client.put(
        f"/comandas/{comanda_id}/delivery/status",
        params={"status_novo": "recusado"}, headers=headers, json={"reason": reason},
    )
    assert replay.status_code == 200, replay.text
    assert _event_names_for_check(comanda_id) == names
    with SessionLocal(restaurante_id=CHAR_RESTAURANT_ID) as db:
        assert {row.id: row.estoque_atual for row in db.query(Insumo).all()} == stock_before


@patch("app.routes.cardapio._enforce_public_order_rate_limits", lambda *args, **kwargs: None)
@patch("app.services.whatsapp.enviar_notificacao_whatsapp_task", lambda *args, **kwargs: None)
def test_lagging_pending_launch_on_preparing_comanda_reconciles_to_ready(char_client, char_setup):
    """Regressão: comanda em produção com lançamento em pendente avança para pronto sem 409."""
    _clear_outbox()
    headers = char_setup["headers"]
    comanda_id = _create_pickup(
        char_client,
        phone="11977770003",
        customer_name="Lagging Pickup",
    )

    # 1. Aceita comanda para producao
    accepted = char_client.put(
        f"/comandas/{comanda_id}/delivery/status",
        params={"status_novo": "producao"},
        headers=headers,
    )
    assert accepted.status_code == 200, accepted.text

    # 2. Simula lançamento legado em 'pendente' dentro da comanda em 'producao'
    db = SessionLocal()
    try:
        comanda = db.query(Comanda).filter(Comanda.id == comanda_id).first()
        assert comanda is not None
        assert comanda.delivery_status == "producao"
        for lanc in comanda.lancamentos:
            lanc.status = "pendente"
        db.commit()
    finally:
        db.close()

    # 3. Avança para pronto: deve reconciliar pendente -> producao -> pronto sem 409
    ready = char_client.put(
        f"/comandas/{comanda_id}/delivery/status",
        params={"status_novo": "pronto"},
        headers=headers,
    )
    assert ready.status_code == 200, ready.text
    assert ready.json()["delivery_status"] == "pronto"

    db = SessionLocal()
    try:
        comanda = db.query(Comanda).filter(Comanda.id == comanda_id).first()
        assert comanda.delivery_status == "pronto"
        for lanc in comanda.lancamentos:
            assert lanc.status == "pronto"
    finally:
        db.close()

    event_names = _event_names_for_check(comanda_id)
    assert "koma.order.accepted" in event_names
    assert "koma.order.ready" in event_names


def test_unaccepted_pending_comanda_rejects_direct_transition_to_ready(char_client, char_setup):
    """Garante que a máquina de estados impede salto direto pendente -> pronto."""
    headers = char_setup["headers"]
    comanda_id = _create_pickup(
        char_client,
        phone="11977770004",
        customer_name="Direct Jump Reject",
    )

    jump = char_client.put(
        f"/comandas/{comanda_id}/delivery/status",
        params={"status_novo": "pronto"},
        headers=headers,
    )
    assert jump.status_code == 409
    assert "pendente" in jump.text
    assert "pronto" in jump.text



def test_delivery_acceptance_is_persisted_then_preparation_emits_separate_event(char_client, char_setup):
    _clear_outbox()
    headers = char_setup["headers"]
    check_id = _create_internal_digital_dine_in()
    db = SessionLocal(restaurante_id=CHAR_RESTAURANT_ID)
    try:
        check = db.query(Comanda).filter(Comanda.id == check_id).one()
        check.tipo = "Delivery"
        db.commit()
    finally:
        db.close()
    def advance(status):
        return char_client.put(f"/comandas/{check_id}/delivery/status", params={"status_novo": status}, headers=headers)
    accepted = advance("aceito")
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["delivery_status"] == "aceito"
    assert advance("pronto").status_code == 409
    assert advance("aceito").status_code == 200
    started = advance("producao")
    assert started.status_code == 200, started.text
    assert started.json()["delivery_status"] == "producao"
    assert advance("producao").status_code == 200
    assert advance("pronto").status_code == 200
    assert advance("transito").status_code == 409
    names = _event_names_for_check(check_id)
    assert names.count("koma.order.accepted") == 1
    assert names.count("koma.order.preparing") == 1
