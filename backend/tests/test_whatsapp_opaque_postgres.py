"""FORCE RLS, HTTP preview/confirm and concurrent replay on disposable PostgreSQL."""
import concurrent.futures
import hashlib
import os
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from app.database import TenantSession, get_db, tenant_session_scope
from app.models import WhatsAppOptOutCapability
from app.routes import whatsapp_opt_out as routes
from app.services.whatsapp_opt_out import create_opt_out_token, resolve_opt_out_token
from app.services.customer_whatsapp_dispatch import opted_out
from app.services.central_whatsapp import recipient_fingerprint

URL = os.getenv('KOMA_SECURITY_TEST_DATABASE_URL', '')
pytestmark = pytest.mark.skipif(not URL, reason='Requires disposable localhost PostgreSQL')


@pytest.fixture
def pg_flow():
    parsed = make_url(URL)
    assert parsed.host in {'127.0.0.1', 'localhost'} and parsed.database == 'koma_security'
    admin = create_engine(URL)
    runtime = create_engine(URL)
    @event.listens_for(runtime, 'connect')
    def role(conn, _):
        cursor = conn.cursor()
        cursor.execute('SET ROLE koma_app')
        cursor.close()
        conn.commit()
    factory = sessionmaker(bind=runtime, class_=TenantSession)
    with admin.begin() as conn:
        for rid in (990801, 990802):
            conn.execute(text("INSERT INTO restaurantes(id,nome,slug,plano,billing_mode,saas_status) VALUES(:rid,:name,:slug,'pocket','legacy','active')"),
                         {'rid': rid, 'name': 'Kôma' if rid == 990801 else 'Outra loja', 'slug': 'd8-burger' if rid == 990801 else 'outra-loja'})
    tokens = []
    for rid in (990801, 990802):
        with factory() as db, tenant_session_scope(db, rid):
            tokens.append(create_opt_out_token(rid, '5511999999999', db))
            db.commit()
    app = FastAPI()
    app.include_router(routes.router)
    def database():
        with factory() as db:
            yield db
    app.dependency_overrides[get_db] = database
    routes._buckets.clear()
    try:
        with TestClient(app) as client:
            yield admin, runtime, factory, client, tokens
    finally:
        with admin.begin() as conn:
            conn.execute(text('DELETE FROM whatsapp_contact_opt_outs WHERE restaurante_id IN (990801,990802)'))
            conn.execute(text('DELETE FROM whatsapp_opt_out_capabilities WHERE restaurante_id IN (990801,990802)'))
            conn.execute(text('DELETE FROM restaurantes WHERE id IN (990801,990802)'))
        runtime.dispose()
        admin.dispose()


def test_http_confirmation_under_real_force_rls_is_isolated_and_concurrent(pg_flow):
    admin, runtime, factory, client, tokens = pg_flow
    with admin.connect() as conn:
        assert conn.execute(text("SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='public.whatsapp_opt_out_capabilities'::regclass")).scalar()
        assert conn.execute(text("SELECT prosecdef AND proconfig @> ARRAY['search_path=pg_catalog'] FROM pg_proc WHERE oid='koma_internal.lookup_whatsapp_opt_out(text)'::regprocedure")).scalar()
        for role in ('anon', 'authenticated'):
            assert not conn.execute(text("SELECT has_table_privilege(:role,'public.whatsapp_opt_out_capabilities','SELECT,INSERT,UPDATE,DELETE')"), {'role': role}).scalar()
            assert not conn.execute(text("SELECT has_function_privilege(:role,'koma_internal.lookup_whatsapp_opt_out(text)','EXECUTE')"), {'role': role}).scalar()
    with runtime.connect() as conn:
        assert conn.execute(text('SELECT count(*) FROM whatsapp_opt_out_capabilities')).scalar() == 0
        conn.execute(text("SELECT set_config('app.current_restaurante_id','990801',true)"))
        assert conn.execute(text('SELECT restaurante_id FROM whatsapp_opt_out_capabilities')).scalars().all() == [990801]
        with pytest.raises(Exception):
            with conn.begin_nested():
                conn.execute(text("INSERT INTO whatsapp_opt_out_capabilities VALUES(:hash,990802,:phone,now()+interval '1 day')"), {'hash': uuid.uuid4().hex * 2, 'phone': 'a' * 64})
    for token in tokens:
        assert client.post('/api/cardapio/whatsapp/opt-out/preview', json={'token': token}).status_code == 200
    with factory() as db, tenant_session_scope(db, 990801):
        assert not opted_out(db, 990801, recipient_fingerprint(990801, '5511999999999'))
    def confirm(_):
        return client.post('/api/cardapio/whatsapp/opt-out', json={'token': tokens[0]}).status_code
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        assert list(pool.map(confirm, range(4))) == [200] * 4
    with admin.connect() as conn:
        assert conn.execute(text('SELECT restaurante_id FROM whatsapp_contact_opt_outs WHERE restaurante_id IN (990801,990802)')).scalars().all() == [990801]
    for rid, expected in ((990801, True), (990802, False)):
        with factory() as db, tenant_session_scope(db, rid):
            assert opted_out(db, rid, recipient_fingerprint(rid, '5511999999999')) is expected
    with factory() as db:
        assert resolve_opt_out_token(tokens[1], db)[0] == 990802
    # A known hash does not disclose the protected contact or permit cross-tenant reads.
    with factory() as db, tenant_session_scope(db, 990801):
        assert db.query(WhatsAppOptOutCapability).filter_by(token_hash=hashlib.sha256(tokens[1].encode()).hexdigest()).first() is None


def test_expiry_and_forgery_fail_without_writes(pg_flow):
    admin, _, _, client, tokens = pg_flow
    with admin.begin() as conn:
        conn.execute(text("UPDATE whatsapp_opt_out_capabilities SET expires_at=now()-interval '1 second' WHERE token_hash=:hash"), {'hash': hashlib.sha256(tokens[0].encode()).hexdigest()})
    for token in (tokens[0], 'a' * 32):
        for path in ('/opt-out/preview', '/opt-out'):
            response = client.post('/api/cardapio/whatsapp' + path, json={'token': token})
            assert response.status_code == 404 and token not in response.text
    with admin.connect() as conn:
        assert conn.execute(text('SELECT count(*) FROM whatsapp_contact_opt_outs WHERE restaurante_id IN (990801,990802)')).scalar() == 0
