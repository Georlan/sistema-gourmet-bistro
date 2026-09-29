from decimal import Decimal
import datetime as dt
import httpx

from app.database import SessionLocal, current_restaurante_id
from app.domain.orders.events import OrderCreated
from app.domain.orders.types import FulfillmentType, OrderChannel
from app.models import ConfiguracaoRestaurante, IntegrationOutbox, Restaurante
from app.security import create_access_token
from app.services.tenant_order_whatsapp import (
    EVENT_NAME,
    enqueue_order_alert,
    instance_name,
    render_alert,
)
from app.services.outbox.dispatcher import dispatch_single_outbox_event, recover_stale_outbox_claims
from tests.characterization.orders.fixtures import CHAR_RESTAURANT_ID, char_client, char_setup


def _order(restaurant_id: int, order_id: str) -> OrderCreated:
    return OrderCreated(
        restaurant_id=restaurant_id,
        order_id=order_id,
        display_number="184",
        channel=OrderChannel.WEB_CARDAPIO,
        fulfillment=FulfillmentType.DELIVERY,
        total=Decimal("67.40"),
        items_count=4,
        customer_name="Pessoa que não deve sair no alerta",
        customer_phone="5511888888888",
    )


def test_alert_is_opt_in_deduplicated_and_private(char_setup):
    db = SessionLocal(restaurante_id=CHAR_RESTAURANT_ID)
    rid = CHAR_RESTAURANT_ID
    other_id = 778
    try:
        config = db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=rid).first()
        config.whatsapp_alerts_enabled = False
        config.whatsapp_instance_name = instance_name(rid)
        config.whatsapp_recipient_phone = "5511999999999"
        db.query(IntegrationOutbox).filter_by(restaurante_id=rid, aggregate_id="wa-test-184").delete()
        db.commit()
        assert enqueue_order_alert(db, _order(rid, "wa-test-184")) is None

        config.whatsapp_alerts_enabled = True
        db.commit()
        first = enqueue_order_alert(db, _order(rid, "wa-test-184"))
        second = enqueue_order_alert(db, _order(rid, "wa-test-184"))
        assert first.id == second.id
        db.commit()
        rows = db.query(IntegrationOutbox).filter_by(restaurante_id=rid, event_name=EVENT_NAME, aggregate_id="wa-test-184").all()
        assert len(rows) == 1
        assert "customer_name" not in rows[0].payload
        assert "customer_phone" not in rows[0].payload
        assert "Pessoa" not in render_alert(rows[0].payload)

        if not db.query(Restaurante).filter_by(id=other_id).first():
            db.add(Restaurante(id=other_id, nome="Outro restaurante", slug="wa-other-778", plano="pocket"))
            db.flush()
        db.commit()
        token = current_restaurante_id.set(other_id)
        other_db = SessionLocal(restaurante_id=other_id)
        try:
            other = other_db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=other_id).first()
            if not other:
                other = ConfiguracaoRestaurante(restaurante_id=other_id)
                other_db.add(other)
            other.whatsapp_alerts_enabled = True
            other.whatsapp_instance_name = instance_name(other_id)
            other.whatsapp_recipient_phone = "5521999999999"
            other_db.query(IntegrationOutbox).filter_by(restaurante_id=other_id, aggregate_id="wa-test-184").delete()
            other_db.commit()
            other_record = enqueue_order_alert(other_db, _order(other_id, "wa-test-184"))
            other_db.commit()
            other_event_id = other_record.event_id
            other_tenant_id = other_record.restaurante_id
            other_db.query(IntegrationOutbox).filter_by(restaurante_id=other_id, aggregate_id="wa-test-184").delete()
            other.whatsapp_alerts_enabled = False
            other_db.commit()
        finally:
            other_db.close()
            current_restaurante_id.reset(token)
        assert other_event_id != first.event_id
        assert other_tenant_id == other_id
        assert db.query(IntegrationOutbox).filter_by(restaurante_id=rid, event_name=EVENT_NAME, aggregate_id="wa-test-184").count() == 1
    finally:
        db.rollback()
        db.query(IntegrationOutbox).filter_by(restaurante_id=rid, aggregate_id="wa-test-184").delete()
        config = db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=rid).first()
        if config:
            config.whatsapp_alerts_enabled = False
            config.whatsapp_instance_name = None
            config.whatsapp_recipient_phone = None
        db.commit()
        db.close()


def test_evolution_qr_control_operations_use_longer_timeout(monkeypatch):
    from app.services import tenant_order_whatsapp as wa

    calls = []

    def fake_request(method, path, *, body=None, timeout_seconds=4.0):
        calls.append((method, path, body, timeout_seconds))
        return {"ok": True}

    monkeypatch.setattr(wa, "_request", fake_request)

    wa.create_instance(123)
    wa.connect_instance(123)

    assert calls[0][0] == "POST"
    assert calls[0][1] == "/instance/create"
    assert calls[0][3] == 15.0
    assert calls[1][0] == "GET"
    assert calls[1][1] == "/instance/connect/koma-restaurant-123"
    assert calls[1][3] == 15.0


def test_pairing_code_uses_same_phone(monkeypatch):
    from app.services import tenant_order_whatsapp as wa

    calls = []

    def fake_request(method, path, *, body=None, timeout_seconds=4.0):
        calls.append((method, path, timeout_seconds))
        return {"qrcode": {"pairingCode": "1234-5678"}}

    monkeypatch.setattr(wa, "_request", fake_request)

    code = wa.connect_instance_with_pairing_code(123, "(11) 99999-9999")

    assert code == "12345678"
    assert calls == [
        (
            "GET",
            "/instance/connect/koma-restaurant-123?number=5511999999999",
            15.0,
        )
    ]


def test_pairing_code_falls_back_to_v23_query_variant(monkeypatch):
    from app.services import tenant_order_whatsapp as wa

    calls = []

    def fake_request(method, path, *, body=None, timeout_seconds=4.0):
        calls.append(path)
        if "phoneNumber=" in path:
            return {"pairingCode": "87654321"}
        return {}

    monkeypatch.setattr(wa, "_request", fake_request)

    assert wa.connect_instance_with_pairing_code(123, "11999999999") == "87654321"
    assert calls == [
        "/instance/connect/koma-restaurant-123?number=5511999999999",
        "/instance/connect/koma-restaurant-123?pairingCode=true&phoneNumber=5511999999999",
    ]


def test_mobile_pairing_configure_returns_pairing_code(char_client, char_setup, monkeypatch):
    from app.services import tenant_order_whatsapp as wa

    rid = CHAR_RESTAURANT_ID
    admin = char_setup["headers"]
    with SessionLocal(restaurante_id=rid) as db:
        config = db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=rid).first()
        config.whatsapp_alerts_enabled = False
        config.whatsapp_instance_name = None
        config.whatsapp_recipient_phone = None
        db.commit()

    monkeypatch.setattr(wa, "create_instance", lambda _: {"qrcode": {"code": "qr-value"}})
    monkeypatch.setattr(
        wa,
        "connect_instance_with_pairing_code",
        lambda restaurant_id, phone: "12345678",
    )

    response = char_client.post(
        "/caixa/configuracoes/whatsapp/configure",
        headers=admin,
        json={"phone": "(11) 99999-9999", "mode": "pairing_code"},
    )

    assert response.status_code == 200, response.text
    assert response.json() == {
        "state": "connecting",
        "enabled": False,
        "qr_code": None,
        "pairing_code": "12345678",
    }

    with SessionLocal(restaurante_id=rid) as db:
        config = db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=rid).first()
        assert config.whatsapp_instance_name == instance_name(rid)
        assert config.whatsapp_recipient_phone == "5511999999999"
        assert config.whatsapp_alerts_enabled is False
        config.whatsapp_instance_name = None
        config.whatsapp_recipient_phone = None
        db.commit()


def test_connection_settings_require_manager_and_never_expose_provider_key(char_client, char_setup):
    admin = char_setup["headers"]
    status = char_client.get("/caixa/configuracoes/whatsapp", headers=admin)
    assert status.status_code == 200
    assert "apikey" not in status.text.lower()
    assert "token" not in status.text.lower()
    assert char_client.get("/caixa/configuracoes/whatsapp").status_code == 401
    waiter_token = create_access_token("usr-char-garcom", CHAR_RESTAURANT_ID, role="garcom")
    waiter = {"Authorization": f"Bearer {waiter_token}"}
    assert char_client.get("/caixa/configuracoes/whatsapp", headers=waiter).status_code == 403
    assert char_client.post("/caixa/configuracoes/whatsapp/enable", headers=waiter).status_code == 403


def test_uncertain_send_is_not_replayed_after_timeout_or_worker_restart(char_setup, monkeypatch):
    from app.services import tenant_order_whatsapp as wa

    rid = CHAR_RESTAURANT_ID
    db = SessionLocal(restaurante_id=rid)
    calls = []

    class TimeoutClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, *args, **kwargs):
            calls.append(kwargs)
            raise httpx.TimeoutException("uncertain")

    try:
        config = db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=rid).first()
        config.whatsapp_alerts_enabled = True
        config.whatsapp_instance_name = instance_name(rid)
        config.whatsapp_recipient_phone = "5511999999999"
        config.whatsapp_next_send_at = None
        config.whatsapp_circuit_open_until = None
        config.whatsapp_consecutive_failures = 0
        db.query(IntegrationOutbox).filter_by(restaurante_id=rid, aggregate_id="wa-timeout-test").delete()
        db.commit()
        event = enqueue_order_alert(db, _order(rid, "wa-timeout-test"))
        db.commit()
        monkeypatch.setattr(wa, "connection_state", lambda _: "open")
        monkeypatch.setattr(wa, "owner_phone", lambda _: "5511999999999")
        monkeypatch.setattr(wa, "_provider", lambda: ("https://provider.test", {"apikey": "test"}))
        monkeypatch.setattr(wa.httpx, "Client", TimeoutClient)
        assert dispatch_single_outbox_event(db, event) is False
        db.refresh(event)
        assert event.status == "dead_letter"
        assert event.attempts == 1
        assert len(calls) == 1
        assert dispatch_single_outbox_event(db, event) is False
        assert len(calls) == 1

        event.status = "processing"
        event.locked_at = dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=5)
        db.commit()
        recover_stale_outbox_claims(db, restaurant_id=rid)
        db.refresh(event)
        assert event.status == "dead_letter"
    finally:
        db.rollback()
        db.query(IntegrationOutbox).filter_by(restaurante_id=rid, aggregate_id="wa-timeout-test").delete()
        config = db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=rid).first()
        if config:
            config.whatsapp_alerts_enabled = False
            config.whatsapp_instance_name = None
            config.whatsapp_recipient_phone = None
            config.whatsapp_next_send_at = None
            config.whatsapp_circuit_open_until = None
            config.whatsapp_consecutive_failures = 0
        db.commit()
        db.close()
