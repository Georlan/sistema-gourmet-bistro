"""Real PostgreSQL commit/fan-out, concurrent retry and migration/RLS coverage.

Use ORDER_CHAT_TEST_DATABASE_URL pointing at a disposable local database only.
Each test gets its own schema; runtime application databases are never used.
"""
import asyncio
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import os
from pathlib import Path
import threading
import uuid

from alembic.migration import MigrationContext
from alembic.operations import Operations
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.order_chat_models import OrderConversationEvent, OrderMessage
from app.services import order_chat_hub as transport
from app.services import order_chat_service as chat
from test_order_chat_unit import _seed_data

URL = os.getenv("ORDER_CHAT_TEST_DATABASE_URL", "")
pytestmark = pytest.mark.skipif(not URL, reason="Requires disposable PostgreSQL")


@pytest.fixture()
def pg(monkeypatch):
    from sqlalchemy.engine import make_url
    parsed = make_url(URL)
    assert parsed.host in {"127.0.0.1", "localhost"}, "Local disposable database required"
    admin = create_engine(URL)
    schema = "chat_p0_" + uuid.uuid4().hex
    with admin.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
        conn.execute(text("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='koma_app') THEN CREATE ROLE koma_app NOLOGIN; END IF; END $$"))
    url = parsed.update_query_dict({"options": f"-csearch_path={schema}"}).render_as_string(hide_password=False)
    engine = create_engine(url)
    # Create the production metadata in an isolated schema, then exercise the new
    # migration on the previous shape of the message table.
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE restaurantes CASCADE"))
    sessions = sessionmaker(bind=engine, autoflush=False)
    monkeypatch.setattr(transport, "engine", engine)
    monkeypatch.setattr(transport, "SessionLocal", sessions)
    monkeypatch.setattr(transport.OrderChatHub, "_postgres_dsn", staticmethod(lambda: url))
    with sessions() as db:
        _seed_data(db)
        db.commit()
    yield engine, sessions, schema
    engine.dispose()
    with admin.begin() as conn:
        conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
    admin.dispose()


def test_two_listeners_receive_only_committed_keys_and_rehydrate(pg):
    engine, sessions, _ = pg
    with sessions() as db:
        conv, _ = chat.create_conversation_for_order(db, 1, "comanda-101")
        db.commit()
        conv_id = conv.id

    async def scenario():
        hubs = [transport.OrderChatHub(), transport.OrderChatHub()]
        subscriptions = [hub.subscribe_conversation(conv_id) for hub in hubs]
        try:
            assert all(await asyncio.gather(*(hub.wait_ready() for hub in hubs)))
            with sessions() as writer:
                msg = chat.send_customer_message(writer, 1, conv_id, "comanda-101", "Confirmada", str(uuid.uuid4()))
                message_id = msg.id
                await asyncio.sleep(0.1)
                assert all(queue.empty() for _, queue in subscriptions)
                writer.commit()
            for _, queue in subscriptions:
                event = await asyncio.wait_for(queue.get(), 3)
                assert event["data"]["id"] == message_id
                assert event["data"]["body"] == "Confirmada"
            with sessions() as writer:
                chat.post_system_order_event(writer, 1, "comanda-101", "pronto")
                writer.rollback()
            await asyncio.sleep(0.1)
            assert all(queue.empty() for _, queue in subscriptions)
        finally:
            for hub, (sub, _) in zip(hubs, subscriptions):
                hub.unsubscribe_conversation(conv_id, sub)
                await asyncio.to_thread(hub.stop)
            assert all(not hub._listener_thread.is_alive() for hub in hubs)
    asyncio.run(scenario())


@pytest.mark.parametrize("sender", ["customer", "staff"])
def test_concurrent_retry_returns_one_message_without_aborting_transaction(pg, monkeypatch, sender):
    _, sessions, _ = pg
    with sessions() as db:
        conv, _ = chat.create_conversation_for_order(db, 1, "comanda-101")
        db.commit()
        conv_id = conv.id
    key = str(uuid.uuid4())
    barrier = threading.Barrier(2)
    state = threading.local()
    original = chat._existing_human_message

    def lookup(*args, **kwargs):
        result = original(*args, **kwargs)
        if not getattr(state, "waited", False):
            state.waited = True
            barrier.wait(timeout=5)
        return result
    monkeypatch.setattr(chat, "_existing_human_message", lookup)

    def send():
        with sessions() as db:
            msg = (chat.send_customer_message(db, 1, conv_id, "comanda-101", "Retry", key)
                   if sender == "customer" else chat.send_staff_message(db, 1, conv_id, "10", "Retry", key))
            result = msg.id
            db.commit()
            return result
    with ThreadPoolExecutor(max_workers=2) as executor:
        ids = list(executor.map(lambda _: send(), range(2)))
    assert ids[0] == ids[1]
    with sessions() as db:
        assert db.query(OrderMessage).filter_by(conversation_id=conv_id).count() == 1


def test_migration_preserves_legacy_feed_and_enforces_rls(pg):
    engine, sessions, schema = pg
    with sessions() as db:
        conv, _ = chat.create_conversation_for_order(db, 1, "comanda-101")
        db.commit()
        conv_id = conv.id
    path = Path(__file__).parents[1] / "alembic/versions/i8d9e0f1a2b3_order_feed_events.py"
    spec = importlib.util.spec_from_file_location("p0_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    legacy_id = str(uuid.uuid4())
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE order_conversation_events"))
        conn.execute(text("ALTER TABLE order_messages DROP CONSTRAINT ck_order_messages_sender_type"))
        conn.execute(text("ALTER TABLE order_messages ADD CONSTRAINT ck_order_messages_sender_type CHECK (sender_type IN ('customer','staff','system'))"))
        conn.execute(text("INSERT INTO order_messages (id,restaurante_id,conversation_id,pedido_id,sender_type,event_key,body,body_format,created_at,feed_seq) VALUES (:id,1,:conv,'comanda-101','system','status:pronto','Pronto &amp; entregue','html_escaped_v1',now(),1)"), {"id": legacy_id, "conv": conv_id})
        with Operations.context(MigrationContext.configure(conn)):
            migration.upgrade()
        assert conn.execute(text("SELECT count(*) FROM order_messages")).scalar() == 0
        assert conn.execute(text("SELECT id FROM order_conversation_events")).scalar() == legacy_id
        conn.execute(text(f'GRANT USAGE ON SCHEMA "{schema}" TO koma_app'))
        conn.execute(text("SET LOCAL row_security = on"))
        conn.execute(text("SET LOCAL ROLE koma_app"))
        conn.execute(text("SELECT set_config('app.current_restaurante_id','2',true)"))
        assert conn.execute(text("SELECT count(*) FROM order_conversation_events")).scalar() == 0
        conn.execute(text("SELECT set_config('app.current_restaurante_id','1',true)"))
        assert conn.execute(text("SELECT count(*) FROM order_conversation_events")).scalar() == 1
        conn.execute(text("RESET ROLE"))
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE order_messages DROP CONSTRAINT uq_order_messages_conv_feed_seq"))
        conn.execute(text("ALTER TABLE order_messages DROP COLUMN feed_seq"))
        with Operations.context(MigrationContext.configure(conn)):
            migration.downgrade()
        assert conn.execute(text("SELECT id FROM order_messages")).scalar() == legacy_id
