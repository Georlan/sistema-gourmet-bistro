import uuid

import httpx
import pywebpush
import pytest

from app.database import SessionLocal
from app.models import Comanda
from app.order_chat_models import OrderConversation, OrderPushSubscription
from app.services import web_push
from tests.characterization.orders.fixtures import CHAR_RESTAURANT_ID, char_client, char_setup


@pytest.mark.parametrize("second_status", [200, 410, 503])
def test_push_releases_sql_during_every_provider_call(char_setup, monkeypatch, second_status):
    rid = CHAR_RESTAURANT_ID
    order_id = str(uuid.uuid4())
    conversation_id = str(uuid.uuid4())
    calls = []
    monkeypatch.setattr(web_push, "get_web_push_config", lambda: web_push.WebPushConfig(
        True, "test-public", "test-private", "mailto:test@example.test", 60,
    ))
    monkeypatch.setattr(web_push, "decrypt_field", lambda value: value)

    with SessionLocal(restaurante_id=rid) as db:
        db.add(Comanda(id=order_id, restaurante_id=rid, garcom_id="usr-char-garcom",
                       numero_pedido=123, tipo="Retirada"))
        db.flush()
        db.add(OrderConversation(id=conversation_id, restaurante_id=rid,
                                 pedido_id=order_id, public_access_token_hash=uuid.uuid4().hex))
        db.flush()
        subscriptions = [OrderPushSubscription(
            restaurante_id=rid, pedido_id=order_id, conversation_id=conversation_id,
            endpoint_hash=uuid.uuid4().hex, endpoint_ciphertext=f"https://push.example.test/{i}",
            p256dh_ciphertext="test-key", auth_ciphertext="test-auth",
        ) for i in range(2)]
        db.add_all(subscriptions)
        db.commit()

        def send(**kwargs):
            assert not db.in_transaction(), "Push provider must not hold SQL"
            assert kwargs["timeout"] == 5.0
            calls.append(kwargs["subscription_info"]["endpoint"])
            if len(calls) == 2 and second_status != 200:
                raise pywebpush.WebPushException("provider failure", response=httpx.Response(second_status))

        monkeypatch.setattr(pywebpush, "webpush", send)
        snapshot = {"restaurante_id": rid, "aggregate_id": order_id,
                    "payload": {"kind": "status", "status": "pronto"}}
        try:
            if second_status == 503:
                with pytest.raises(pywebpush.WebPushException):
                    web_push.dispatch_order_push_event(db, snapshot)
            else:
                assert web_push.dispatch_order_push_event(db, snapshot) == (2 if second_status == 200 else 1)
            db.commit()
            assert len(calls) == 2
            rows = db.query(OrderPushSubscription).filter_by(pedido_id=order_id).all()
            assert sum(row.last_sent_at is not None for row in rows) == (2 if second_status == 200 else 1)
            assert sum(not row.enabled for row in rows) == (1 if second_status == 410 else 0)
        finally:
            db.rollback()
            db.query(OrderPushSubscription).filter_by(pedido_id=order_id).delete()
            db.query(OrderConversation).filter_by(id=conversation_id).delete()
            db.query(Comanda).filter_by(id=order_id).delete()
            db.commit()
