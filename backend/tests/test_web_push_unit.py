from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.services import web_push


def test_web_push_is_fail_closed_without_complete_config(monkeypatch):
    monkeypatch.setenv("WEB_PUSH_ENABLED", "true")
    monkeypatch.delenv("WEB_PUSH_VAPID_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("WEB_PUSH_VAPID_PRIVATE_KEY", raising=False)
    monkeypatch.delenv("WEB_PUSH_VAPID_SUBJECT", raising=False)

    assert web_push.get_web_push_config().ready is False


def test_web_push_endpoint_requires_https():
    with pytest.raises(HTTPException) as exc:
        web_push.validate_push_endpoint("http://push.example.test/subscription")
    assert exc.value.status_code == 422

    assert web_push.validate_push_endpoint("https://push.example.test/subscription") == (
        "https://push.example.test/subscription"
    )


def test_endpoint_hash_is_deterministic_without_exposing_endpoint():
    endpoint = "https://push.example.test/private-capability/abc123"
    digest = web_push.endpoint_hash(endpoint)
    assert digest == web_push.endpoint_hash(endpoint)
    assert endpoint not in digest
    assert len(digest) == 64


def test_staff_message_push_never_contains_message_body():
    comanda = SimpleNamespace(
        id="order-1",
        restaurante_id=7,
        numero_pedido=15,
        tipo="Retirada",
    )
    snapshot = {
        "payload": {
            "restaurant_id": 7,
            "order_id": "order-1",
            "conversation_id": "conv-1",
            "kind": "message",
            "status": None,
        }
    }
    payload = web_push._notification_for(snapshot, comanda)
    assert payload["title"] == "KÔMA • Pedido #15"
    assert payload["body"] == "O restaurante enviou uma nova mensagem."
    assert payload["data"]["pedidoId"] == "order-1"
    assert "token" not in str(payload).lower()


def test_ready_notification_differs_by_fulfillment():
    pickup = SimpleNamespace(id="p1", restaurante_id=1, numero_pedido=1, tipo="Retirada")
    delivery = SimpleNamespace(id="p2", restaurante_id=1, numero_pedido=2, tipo="Delivery")
    snapshot = {"payload": {"kind": "status", "status": "pronto", "conversation_id": "c"}}

    assert "retirada" in web_push._notification_for(snapshot, pickup)["body"].lower()
    assert "aguardando saída" in web_push._notification_for(snapshot, delivery)["body"].lower()
