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


def test_raw_sql_cannot_cross_tenant_read_write_or_move_rows(databases):
    from sqlalchemy.exc import DBAPIError
    admin, runtime, marker = databases
    with runtime.connect() as connection:
        assert connection.execute(text("SELECT count(*) FROM public.notificacoes_whatsapp")).scalar() == 0
        connection.rollback()
        connection.execute(text("SELECT set_config('app.current_restaurante_id','9701',true)"))
        assert set(connection.execute(text("SELECT DISTINCT restaurante_id FROM public.notificacoes_whatsapp")).scalars()) == {9701}
        assert connection.execute(text("UPDATE public.notificacoes_whatsapp SET status='read' WHERE restaurante_id=9702")).rowcount == 0
        assert connection.execute(text("DELETE FROM public.notificacoes_whatsapp WHERE restaurante_id=9702")).rowcount == 0
        connection.rollback()
        connection.execute(text("SELECT set_config('app.current_restaurante_id','9701',true)"))
        with pytest.raises(DBAPIError) as caught:
            connection.execute(text("INSERT INTO public.notificacoes_whatsapp(restaurante_id,wamid) VALUES(9702,:id)"), {"id": marker + ".forged"})
        assert caught.value.orig.pgcode == "42501"
        connection.rollback()
        connection.execute(text("SELECT set_config('app.current_restaurante_id','9701',true)"))
        with pytest.raises(DBAPIError) as caught:
            connection.execute(text("UPDATE public.notificacoes_whatsapp SET restaurante_id=9702 WHERE wamid=:id"), {"id": marker + ".a"})
        assert caught.value.orig.pgcode == "42501"
        connection.rollback()
        # Reused connection must not retain a completed transaction's tenant.
        assert connection.execute(text("SELECT count(*) FROM public.notificacoes_whatsapp")).scalar() == 0
    with admin.connect() as connection:
        assert connection.execute(text("SELECT count(*) FROM public.notificacoes_whatsapp WHERE restaurante_id IN (9701,9702)")).scalar() == 4


def test_notification_rls_is_forced_and_browser_table_access_is_revoked(databases):
    admin, _, _ = databases
    with admin.connect() as connection:
        assert connection.execute(text("SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='public.notificacoes_whatsapp'::regclass")).scalar()
        assert connection.execute(text("SELECT count(*) FROM pg_policies WHERE schemaname='public' AND policyname IN ('leitura_publica_cardapio','leitura_publica_categorias','leitura_publica_produtos')")).scalar() == 0
        for role in ("anon", "authenticated"):
            for table in ("restaurantes", "categorias", "produtos", "notificacoes_whatsapp"):
                assert not connection.execute(text("SELECT has_table_privilege(:role,:table,'SELECT,INSERT,UPDATE,DELETE')"), {"role": role, "table": "public." + table}).scalar()


def test_policy_migration_round_trip_preserves_all_notification_records(databases, monkeypatch):
    from alembic import command
    from alembic.config import Config
    admin, _, _ = databases
    from app.config import settings
    monkeypatch.setattr(settings, "MIGRATION_DATABASE_URL", URL)
    monkeypatch.setenv("MIGRATION_DATABASE_URL", URL)
    monkeypatch.setenv("DATABASE_URL", URL)
    config = Config("backend/alembic.ini")
    def snapshot():
        with admin.connect() as connection:
            return connection.execute(text("SELECT id,restaurante_id,wamid,status FROM public.notificacoes_whatsapp ORDER BY id")).all()
    before = snapshot()
    command.downgrade(config, "34636096d350")
    assert snapshot() == before
    command.upgrade(config, "head")
    assert snapshot() == before


def test_public_menu_uses_runtime_api_without_anonymous_table_grants(databases):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.database import get_db
    from app.models import Categoria, Produto
    from app.routes import cardapio_digital
    admin, runtime, marker = databases
    with sessionmaker(bind=admin)() as db:
        for tenant in (9701,9702):
            category_id = marker + str(tenant)
            db.add(Categoria(id=category_id, restaurante_id=tenant, nome=f"Synthetic Category {tenant}"))
            db.flush()
            db.add(Produto(id=category_id, restaurante_id=tenant, categoria_id=category_id, nome=f"Synthetic Product {tenant}", preco=10, ativo=True))
        db.commit()
    app = FastAPI()
    app.include_router(cardapio_digital.router)
    factory = sessionmaker(bind=runtime, class_=TenantSession)
    def scoped_database():
        with factory() as db:
            yield db
    app.dependency_overrides[get_db] = scoped_database
    try:
        with TestClient(app) as client:
            for tenant in (9701,9702):
                response = client.get(f"/api/cardapio-digital/public?restaurante_id={tenant}")
                assert response.status_code == 200
                menu = response.json()
                assert menu["restaurante"]["id"] == tenant
                assert {item["nome"] for item in menu["produtos"]} == {f"Synthetic Product {tenant}"}
                assert "plano" not in menu["restaurante"]
    finally:
        with admin.begin() as connection:
            connection.execute(text("DELETE FROM public.produtos WHERE restaurante_id IN (9701,9702)"))
            connection.execute(text("DELETE FROM public.categorias WHERE restaurante_id IN (9701,9702)"))


def test_legacy_notification_without_tenant_is_preserved_and_not_resolved(databases):
    admin, runtime, marker = databases
    orphan = marker + ".legacy-orphan"
    with admin.begin() as connection:
        connection.execute(text("INSERT INTO public.notificacoes_whatsapp(restaurante_id,wamid,status) VALUES(NULL,:id,'sent')"), {"id": orphan})
    try:
        with runtime.connect() as connection:
            assert connection.execute(text("SELECT * FROM koma_internal.lookup_whatsapp_notification(:id)"), {"id": orphan}).all() == []
        whatsapp_webhook._update_known_statuses([{"statuses": [{"id": orphan, "status": "delivered"}]}])
        with admin.connect() as connection:
            assert connection.execute(text("SELECT status FROM public.notificacoes_whatsapp WHERE wamid=:id"), {"id": orphan}).scalar() == "sent"
    finally:
        with admin.begin() as connection:
            connection.execute(text("DELETE FROM public.notificacoes_whatsapp WHERE wamid=:id"), {"id": orphan})
