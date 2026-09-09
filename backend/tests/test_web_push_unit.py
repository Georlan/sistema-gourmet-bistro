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


def test_message_preview_is_direct_but_redacts_sensitive_patterns():
    preview = web_push.sanitize_message_preview(
        "Pode vir buscar. Meu telefone é +55 (11) 99999-8888 e a chave pix: segredo@example.com"
    )
    assert "Pode vir buscar" in preview
    assert "99999" not in preview
    assert "segredo@example.com" not in preview
    assert "[telefone]" in preview
    assert "[dado protegido]" in preview or "[e-mail]" in preview


def test_message_preview_redacts_address_and_truncates():
    preview = web_push.sanitize_message_preview(
        "Entregar na Rua das Flores 123, bloco 2. " + ("mensagem longa " * 30)
    )
    assert "Rua das Flores" not in preview
    assert "[endereço]" in preview
    assert len(preview) <= web_push.MESSAGE_PREVIEW_MAX_CHARS


def test_staff_message_push_uses_preview_without_token_or_outbox_body():
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
            "message_id": "message-1",
        }
    }
    payload = web_push._notification_for(snapshot, comanda, message_body="vem ca")
    assert payload["title"] == "Nova mensagem • Pedido #15"
    assert payload["body"] == "vem ca"
    assert payload["data"]["pedidoId"] == "order-1"
    assert payload["data"]["kind"] == "message"
    assert payload["actions"][0]["title"] == "Abrir conversa"
    assert payload["tag"].endswith("-message")
    assert "message_body" not in snapshot["payload"]
    assert "token" not in str(payload).lower()


def test_status_notification_uses_stable_tag_and_human_status():
    pickup = SimpleNamespace(id="p1", restaurante_id=1, numero_pedido=18, tipo="Retirada")
    preparing = {"payload": {"kind": "status", "status": "producao", "conversation_id": "c"}}
    ready = {"payload": {"kind": "status", "status": "pronto", "conversation_id": "c"}}

    first = web_push._notification_for(preparing, pickup)
    second = web_push._notification_for(ready, pickup)

    assert first["tag"] == second["tag"]
    assert first["tag"].endswith("-status")
    assert "Em preparo" in first["title"]
    assert "Pronto" in second["title"]
    assert "retirada" in second["body"].lower()
    assert second["actions"][0]["title"] == "Acompanhar pedido"
    assert second["renotify"] is True


def test_ready_notification_differs_by_fulfillment():
    pickup = SimpleNamespace(id="p1", restaurante_id=1, numero_pedido=1, tipo="Retirada")
    delivery = SimpleNamespace(id="p2", restaurante_id=1, numero_pedido=2, tipo="Delivery")
    snapshot = {"payload": {"kind": "status", "status": "pronto", "conversation_id": "c"}}

    assert "retirada" in web_push._notification_for(snapshot, pickup)["body"].lower()
    assert "aguardando saída" in web_push._notification_for(snapshot, delivery)["body"].lower()
