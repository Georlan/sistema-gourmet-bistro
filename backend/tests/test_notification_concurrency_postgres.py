"""Duplicate tasks against disposable loopback PostgreSQL, never production."""
import asyncio
import os
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import Column, Integer, MetaData, String, Table, create_engine, event, insert, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from app.config import settings
from app.models import NotificacaoWhatsApp
from app.services import notificacoes as notices, whatsapp


@pytest.fixture
def notification_postgres():
    raw = os.getenv("KOMA_NOTIFICATION_TEST_POSTGRES_URL", "")
    if not raw:
        pytest.skip("Requires disposable loopback koma_notification_test")
    url = make_url(raw)
    assert url.get_backend_name() == "postgresql"
    assert url.host in {"localhost", "127.0.0.1", "::1"}
    assert url.database == "koma_notification_test"
    schema = "notification_race_" + uuid.uuid4().hex
    admin = create_engine(url)
    engine = create_engine(url, execution_options={"schema_translate_map": {None: schema}})

    @event.listens_for(engine, "connect")
    def scoped(connection, record):
        with connection.cursor() as cursor:
            cursor.execute(f'SET search_path TO "{schema}"')
            cursor.execute("SET statement_timeout TO '10000ms'")
        connection.commit()

    metadata = MetaData()
    Table("restaurantes", metadata, Column("id", Integer, primary_key=True))
    Table("comandas", metadata, Column("id", String, primary_key=True), Column("restaurante_id", Integer))
    NotificacaoWhatsApp.__table__.to_metadata(metadata)
    try:
        with admin.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        metadata.create_all(engine)
        with engine.begin() as connection:
            connection.execute(insert(metadata.tables["restaurantes"]), [{"id":880091}, {"id":880092}])
            connection.execute(insert(metadata.tables["comandas"]), [{"id":"check-a", "restaurante_id":880091}, {"id":"check-b", "restaurante_id":880092}])
        yield sessionmaker(bind=engine, autoflush=False)
    finally:
        engine.dispose()
        with admin.begin() as connection:
            connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        admin.dispose()


def test_concurrent_tasks_reserve_once_without_holding_lock_during_http(notification_postgres, monkeypatch):
    sessions = notification_postgres
    monkeypatch.setattr(settings, "KOMA_WHATSAPP_AUTOMATION_ENABLED", True)
    monkeypatch.setattr(notices, "status_recipient_eligible", lambda *args: True)
    start = threading.Barrier(2)
    duplicate_done = threading.Event()
    sends = []

    def provider(*args, **kwargs):
        sends.append(1)
        # The other task must see the committed pending record while this send
        # is in flight. Holding the check lock during HTTP would deadlock here.
        assert duplicate_done.wait(5)
        return whatsapp.ResultadoEnvioWhatsApp(sucesso=True, provider="evolution")

    monkeypatch.setattr(whatsapp, "enviar_texto_whatsapp_detalhado", provider)

    def task():
        with sessions() as db:
            start.wait(timeout=5)
            result = asyncio.run(notices.enviar_notificacao_whatsapp(db, telefone="81999991111", conteudo="synthetic", tipo="status_pedido", restaurante_id=880091, comanda_id="check-a"))
            if result.get("duplicada"):
                duplicate_done.set()
            return result

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: task(), range(2)))
    assert len(sends) == 1
    assert sum(bool(result.get("duplicada")) for result in results) == 1
    with sessions() as db:
        assert db.query(NotificacaoWhatsApp).filter_by(restaurante_id=880091).count() == 1
        assert db.query(NotificacaoWhatsApp).filter_by(restaurante_id=880092).count() == 0
