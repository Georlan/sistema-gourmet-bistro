"""P0 regression tests: transaction boundaries and durable mixed feed."""
import asyncio
import datetime
import uuid

import pytest
from fastapi import HTTPException

from test_order_chat_unit import client_and_session, _seed_data
from app.order_chat_models import OrderConversationEvent, OrderMessage
from app.services import order_chat_hub as transport
from app.services.order_chat_service import (
    create_conversation_for_order, list_recent_messages, post_system_order_event,
    send_customer_message, send_staff_message,
)


def test_rollback_and_nested_rollback_never_publish(client_and_session, monkeypatch):
    _, db = client_and_session
    _seed_data(db)
    conv, _ = create_conversation_for_order(db, 1, "comanda-101")
    db.commit()
    captured = []
    monkeypatch.setattr(transport.order_chat_hub, "publish_committed", captured.append)
    transport.queue_order_chat_event(db, restaurante_id=1, conversation_id=conv.id,
                                    kind="read", data={"reader": "staff"})
    with db.begin_nested() as nested:
        post_system_order_event(db, 1, "comanda-101", "pronto")
        nested.rollback()
    assert captured == []
    db.commit()
    assert [item["kind"] for item in captured] == ["read"]
    assert db.query(OrderConversationEvent).count() == 0
    captured.clear()
    send_customer_message(db, 1, conv.id, conv.pedido_id, "rollback", str(uuid.uuid4()))
    db.rollback()
    db.commit()
    assert captured == []
    assert db.query(OrderMessage).count() == 0


def test_feed_events_survive_reconnect_and_do_not_become_messages(client_and_session):
    client, db = client_and_session
    _seed_data(db)
    conv, token = create_conversation_for_order(db, 1, "comanda-101")
    db.commit()
    post_system_order_event(db, 1, conv.pedido_id, "producao")
    post_system_order_event(db, 1, conv.pedido_id, "producao")
    send_staff_message(db, 1, conv.id, "10", "Anotado", str(uuid.uuid4()))
    db.commit()
    feed = client.get(f"/api/cardapio/pedidos/acompanhar/{token}/messages").json()
    assert [item["kind"] for item in feed] == ["order_event", "message"]
    assert feed[0]["status"] == "producao"
    assert db.query(OrderMessage).count() == 1
    assert db.query(OrderConversationEvent).count() == 1


def test_retry_after_terminal_returns_existing_but_new_write_stays_closed(client_and_session):
    _, db = client_and_session
    _seed_data(db)
    conv, _ = create_conversation_for_order(db, 1, "comanda-101")
    key = str(uuid.uuid4())
    msg = send_customer_message(db, 1, conv.id, conv.pedido_id, "Original", key)
    db.commit()
    post_system_order_event(db, 1, conv.pedido_id, "finalizado")
    db.commit()
    assert send_customer_message(db, 1, conv.id, conv.pedido_id, "Original", key).id == msg.id
    with pytest.raises(HTTPException) as exc:
        send_customer_message(db, 1, conv.id, conv.pedido_id, "Nova", str(uuid.uuid4()))
    assert exc.value.status_code == 409


def test_same_key_other_sender_does_not_disclose_or_duplicate(client_and_session):
    _, db = client_and_session
    _seed_data(db)
    conv, _ = create_conversation_for_order(db, 1, "comanda-101")
    key = str(uuid.uuid4())
    send_customer_message(db, 1, conv.id, conv.pedido_id, "Cliente", key)
    db.commit()
    with pytest.raises(HTTPException) as exc:
        send_staff_message(db, 1, conv.id, "10", "Equipe", key)
    assert exc.value.status_code == 409
    assert db.query(OrderMessage).count() == 1


def test_notify_contains_keys_only(client_and_session, monkeypatch):
    _, db = client_and_session
    _seed_data(db)
    conv, _ = create_conversation_for_order(db, 1, "comanda-101")
    db.commit()
    captured = []
    monkeypatch.setattr(transport.order_chat_hub, "publish_committed", captured.append)
    msg = send_customer_message(db, 1, conv.id, conv.pedido_id, "Texto privado " * 60, str(uuid.uuid4()))
    db.commit()
    assert captured[0]["data"] == {"message_id": msg.id}


def test_status_fanout_reads_committed_order_and_feed(client_and_session):
    _, db = client_and_session
    _seed_data(db)
    conv, _ = create_conversation_for_order(db, 1, "comanda-101")
    db.commit()

    async def scenario():
        sub, queue = transport.order_chat_hub.subscribe_conversation(conv.id)
        try:
            conv.comanda.delivery_status = "pronto"
            post_system_order_event(db, 1, conv.pedido_id, "pronto")
            assert queue.empty()
            db.commit()
            payload = await asyncio.wait_for(queue.get(), 1)
            assert payload["event"] == "status"
            assert payload["data"]["status"] == "pronto"
            assert payload["data"]["feed_event"]["kind"] == "order_event"
        finally:
            transport.order_chat_hub.unsubscribe_conversation(conv.id, sub)
    asyncio.run(scenario())


def test_sqlite_migration_roundtrip_preserves_uuid_and_legacy_event(client_and_session):
    import importlib.util
    from pathlib import Path
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import text

    _, db = client_and_session
    _seed_data(db)
    conv, _ = create_conversation_for_order(db, 1, "comanda-101")
    db.commit()
    from app.database import Base
    Base.metadata.create_all(db.get_bind())
    conv_id = conv.id
    db.rollback()
    path = Path(__file__).parents[1] / "alembic/versions/i8d9e0f1a2b3_order_feed_events.py"
    spec = importlib.util.spec_from_file_location("sqlite_p0_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    key = str(uuid.uuid4())
    with db.get_bind().begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            migration.downgrade()
        conn.execute(text("INSERT INTO order_messages (id,restaurante_id,conversation_id,pedido_id,sender_type,event_key,body,body_format,created_at,client_message_id) VALUES ('human',1,:conv,'comanda-101','customer',NULL,'Original','plain_text_v2',CURRENT_TIMESTAMP,:key), ('event',1,:conv,'comanda-101','system','status:pronto','Pronto','plain_text_v2',CURRENT_TIMESTAMP,NULL)"), {"conv": conv_id, "key": key})
        with Operations.context(MigrationContext.configure(conn)):
            migration.upgrade()
    assert send_customer_message(db, 1, conv_id, "comanda-101", "Original", key).id == "human"
    feed = list_recent_messages(db, restaurante_id=1, conversation_id=conv_id)
    assert {item["kind"] for item in feed} == {"message", "order_event"}
    db.rollback()
    with db.get_bind().begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            migration.downgrade()
        assert conn.execute(text("SELECT client_message_id FROM order_messages WHERE id='human'")).scalar() == key
        assert conn.execute(text("SELECT count(*) FROM order_messages")).scalar() == 2
