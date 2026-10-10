from decimal import Decimal
import uuid
import httpx
import pywebpush
import pytest
from app.database import SessionLocal
from app.domain.orders.events import OrderCreated
from app.domain.orders.types import OrderChannel, FulfillmentType
from app.models import Usuario, IntegrationOutbox
from app.order_chat_models import StaffPushSubscription
from app.services import staff_push
from app.services.web_push import WebPushConfig
from tests.characterization.orders.fixtures import CHAR_RESTAURANT_ID, char_client, char_setup


@pytest.fixture
def enabled(monkeypatch):
    monkeypatch.setenv("STAFF_PUSH_RESTAURANT_IDS", str(CHAR_RESTAURANT_ID))
    monkeypatch.setattr(staff_push, "get_web_push_config", lambda: WebPushConfig(True, "public", "private", "mailto:test@example.test", 3600))


def test_explicit_rollout_preserves_live_tenant(monkeypatch, enabled):
    assert staff_push.enabled_for(CHAR_RESTAURANT_ID)
    assert not staff_push.enabled_for(6)
    monkeypatch.delenv("STAFF_PUSH_RESTAURANT_IDS")
    assert not staff_push.enabled_for(CHAR_RESTAURANT_ID)


def test_enqueue_is_atomic_and_idempotent(char_setup, enabled):
    order_id = str(uuid.uuid4())
    order = OrderCreated(restaurant_id=CHAR_RESTAURANT_ID, order_id=order_id, display_number="123",
        channel=OrderChannel.WEB_CARDAPIO, fulfillment=FulfillmentType.DELIVERY, total=Decimal("25"), items_count=1)
    with SessionLocal(restaurante_id=CHAR_RESTAURANT_ID) as db:
        assert staff_push.enqueue_staff_order_alert(db, order)
        assert staff_push.enqueue_staff_order_alert(db, order)
        db.flush()
        assert db.query(IntegrationOutbox).filter_by(event_name=staff_push.EVENT, aggregate_id=order_id).count() == 1
        db.rollback()
        assert db.query(IntegrationOutbox).filter_by(aggregate_id=order_id).count() == 0


@pytest.mark.parametrize("provider_status", [200, 410, 503])
def test_delivery_releases_sql_and_handles_expired_devices(char_setup, enabled, monkeypatch, provider_status):
    with SessionLocal(restaurante_id=CHAR_RESTAURANT_ID) as db:
        db.query(StaffPushSubscription).delete()
        user = db.query(Usuario).filter_by(id="usr-char-admin").one()
        row = staff_push.save_subscription(db, user, "https://push.example.test/device", "key", "auth")
        row_id = row.id
        assert row.endpoint_ciphertext != "https://push.example.test/device"
        db.commit()
        def send(**kwargs):
            assert not db.in_transaction()
            assert kwargs["ttl"] == 600
            assert "customer" not in kwargs["data"]
            if provider_status != 200:
                raise pywebpush.WebPushException("failed", response=httpx.Response(provider_status))
        monkeypatch.setattr(pywebpush, "webpush", send)
        snapshot = {"restaurante_id": CHAR_RESTAURANT_ID, "payload": {"restaurant_id": CHAR_RESTAURANT_ID, "order_id": "o1", "display_number": "42"}}
        if provider_status == 503:
            with pytest.raises(RuntimeError, match="Serviço de notificações indisponível"):
                staff_push.dispatch_staff_push(db, snapshot)
        else:
            assert staff_push.dispatch_staff_push(db, snapshot) == (provider_status == 200)
        db.expire_all()
        row = db.get(StaffPushSubscription, row_id)
        assert row.enabled == (provider_status != 410)
        assert (row.last_sent_at is not None) == (provider_status == 200)
        db.query(StaffPushSubscription).delete()
        db.commit()


def test_removed_permission_prevents_delivery(char_setup, enabled, monkeypatch):
    with SessionLocal(restaurante_id=CHAR_RESTAURANT_ID) as db:
        db.query(StaffPushSubscription).delete()
        user = db.query(Usuario).filter_by(id="usr-char-garcom").one()
        row = staff_push.save_subscription(db, user, "https://push.example.test/no-permission", "key", "auth")
        row_id = row.id
        db.commit()
        monkeypatch.setattr(pywebpush, "webpush", lambda **kwargs: pytest.fail("unauthorized push"))
        assert staff_push.dispatch_staff_push(db, {"restaurante_id": CHAR_RESTAURANT_ID, "payload": {"restaurant_id": CHAR_RESTAURANT_ID, "order_id": "o1"}}) == 0
        db.expire_all()
        assert not db.get(StaffPushSubscription, row_id).enabled
        db.query(StaffPushSubscription).delete()
        db.commit()


def test_mismatched_tenant_rejected(enabled):
    with pytest.raises(ValueError):
        staff_push.dispatch_staff_push(None, {"restaurante_id": 6, "payload": {"restaurant_id": CHAR_RESTAURANT_ID}})


def test_authenticated_subscription_lifecycle_and_role_guard(char_setup, char_client, enabled):
    from app.security import create_access_token
    headers = char_setup["headers"]
    body = {"endpoint": "https://push.example.test/android-lifecycle", "keys": {"p256dh": "key", "auth": "auth"}}
    assert char_client.get("/caixa/notificacoes/config").status_code == 401
    token = create_access_token(subject="usr-char-garcom", restaurante_id=CHAR_RESTAURANT_ID, role="garcom")
    assert char_client.put("/caixa/notificacoes/subscription", json=body, headers={"Authorization": f"Bearer {token}"}).status_code == 403
    for _ in range(2):
        assert char_client.put("/caixa/notificacoes/subscription", json=body, headers=headers).status_code == 200
    with SessionLocal(restaurante_id=CHAR_RESTAURANT_ID) as db:
        assert db.query(StaffPushSubscription).filter_by(endpoint_hash=staff_push.endpoint_hash(body["endpoint"])).count() == 1
    assert char_client.post("/caixa/notificacoes/status", json={"endpoint": body["endpoint"]}, headers=headers).json() == {"enabled": True}
    assert char_client.request("DELETE", "/caixa/notificacoes/subscription", json={"endpoint": body["endpoint"]}, headers=headers).status_code == 200
    assert char_client.post("/caixa/notificacoes/status", json={"endpoint": body["endpoint"]}, headers=headers).json() == {"enabled": False}


def test_pending_online_payment_does_not_alert_before_approval(char_setup, enabled):
    from app.models import Comanda
    order_id, check_id = str(uuid.uuid4()), str(uuid.uuid4())
    order = OrderCreated(restaurant_id=CHAR_RESTAURANT_ID, order_id=order_id, check_id=check_id, display_number="123",
        channel=OrderChannel.WEB_CARDAPIO, fulfillment=FulfillmentType.DELIVERY, total=Decimal("25"), items_count=1)
    with SessionLocal(restaurante_id=CHAR_RESTAURANT_ID) as db:
        check = Comanda(id=check_id, restaurante_id=CHAR_RESTAURANT_ID, garcom_id="usr-char-admin", tipo="Delivery", numero_pedido=9876, online_payment_status="pending")
        db.add(check)
        db.flush()
        assert not staff_push.enqueue_staff_order_alert(db, order)
        check.online_payment_status = "approved"
        db.flush()
        assert staff_push.enqueue_staff_order_alert(db, order)
        db.rollback()
