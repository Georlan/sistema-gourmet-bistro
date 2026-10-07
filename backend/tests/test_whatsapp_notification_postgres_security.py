"""Real PostgreSQL callback boundaries, using an explicitly disposable database."""
import os
import uuid

import pytest
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker

from app.database import TenantSession, current_restaurante_id
from app.models import NotificacaoWhatsApp, Restaurante
from app.routes import whatsapp_webhook

URL = os.getenv("KOMA_SECURITY_TEST_DATABASE_URL", "")
pytestmark = pytest.mark.skipif(not URL, reason="Requires isolated PostgreSQL security database")


@pytest.fixture
def databases(monkeypatch):
    from sqlalchemy.engine import make_url
    parsed = make_url(URL)
    assert parsed.host in {"127.0.0.1", "localhost"}
    assert parsed.database == "koma_security"
    admin = create_engine(URL)
    runtime = create_engine(URL)

    @event.listens_for(runtime, "connect")
    def runtime_role(connection, record):
        cursor = connection.cursor()
        cursor.execute("SET ROLE koma_app")
        cursor.close()
        connection.commit()

    factory = sessionmaker(bind=runtime, class_=TenantSession, autoflush=False)
    monkeypatch.setattr(whatsapp_webhook, "SessionLocal", factory)
    marker = "wamid.security." + uuid.uuid4().hex
    with sessionmaker(bind=admin)() as db:
        for tenant in (9701, 9702):
            db.add(Restaurante(id=tenant, nome=f"Synthetic Security {tenant}", slug=f"security-{tenant}"))
        db.flush()
        db.add_all([
            NotificacaoWhatsApp(restaurante_id=9701, wamid=marker + ".a", status="sent", status_envio="enviado"),
            NotificacaoWhatsApp(restaurante_id=9702, wamid=marker + ".b", status="sent", status_envio="enviado"),
            NotificacaoWhatsApp(restaurante_id=9701, wamid=marker + ".duplicate", status="sent"),
            NotificacaoWhatsApp(restaurante_id=9702, wamid=marker + ".duplicate", status="sent"),
        ])
        db.commit()
    try:
        yield admin, runtime, marker
    finally:
        with admin.begin() as connection:
            connection.execute(text("DELETE FROM public.notificacoes_whatsapp WHERE restaurante_id IN (9701,9702)"))
            connection.execute(text("DELETE FROM public.restaurantes WHERE id IN (9701,9702)"))
        runtime.dispose()
        admin.dispose()


def test_callback_resolves_only_unique_identity_and_updates_each_tenant(databases):
    admin, runtime, marker = databases
    with runtime.connect() as connection:
        for suffix in ("duplicate", "unknown"):
            assert connection.execute(text("SELECT * FROM koma_internal.lookup_whatsapp_notification(:id)"), {"id": marker + "." + suffix}).all() == []
    previous = current_restaurante_id.get()
    whatsapp_webhook._update_known_statuses([{"statuses": [
        {"id": marker + ".a", "status": "delivered"},
        {"id": marker + ".b", "status": "read"},
        {"id": marker + ".duplicate", "status": "read"},
        {"id": marker + ".unknown", "status": "read"},
    ]}])
    whatsapp_webhook._update_known_statuses([{"statuses": [{"id": marker + ".a", "status": "sent"}]}])
    assert current_restaurante_id.get() == previous
    with admin.connect() as connection:
        rows = dict(connection.execute(text("SELECT wamid,status FROM public.notificacoes_whatsapp WHERE restaurante_id IN (9701,9702) AND wamid != :duplicate"), {"duplicate": marker + ".duplicate"}).all())
        assert rows == {marker + ".a": "delivered", marker + ".b": "read"}
        assert connection.execute(text("SELECT count(*) FROM public.notificacoes_whatsapp WHERE wamid=:id AND status='sent'"), {"id": marker + ".duplicate"}).scalar() == 2


def test_lookup_is_internal_fixed_search_path_and_not_browser_executable(databases):
    admin, _, _ = databases
    with admin.connect() as connection:
        assert connection.execute(text("SELECT prosecdef AND proconfig @> ARRAY['search_path=pg_catalog'] FROM pg_proc WHERE oid='koma_internal.lookup_whatsapp_notification(text)'::regprocedure")).scalar()
        assert connection.execute(text("SELECT has_function_privilege('koma_app','koma_internal.lookup_whatsapp_notification(text)','EXECUTE')")).scalar()
        for role in ("anon", "authenticated"):
            if connection.execute(text("SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=:role)"), {"role": role}).scalar():
                assert not connection.execute(text("SELECT has_function_privilege(:role,'koma_internal.lookup_whatsapp_notification(text)','EXECUTE')"), {"role": role}).scalar()
