"""Real PostgreSQL trigger/RLS/concurrency coverage; dedicated local/CI databases only."""
import importlib.util
import os
from pathlib import Path
import threading
import uuid
from datetime import datetime, timedelta

import httpx
import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, MetaData, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.database import TenantSession, tenant_session_scope
from app.models import Restaurante, Categoria, Produto, ProductImageRetirement
from app.services.product_image_lifecycle import collect, reconcile

NOW = datetime(2026, 10, 4, 12)


@pytest.fixture
def pg():
    raw = os.getenv('KOMA_IMAGE_GC_TEST_DATABASE_URL')
    if not raw:
        pytest.skip('Dedicated PostgreSQL test URL not supplied')
    url = make_url(raw)
    if url.host not in {'127.0.0.1', 'localhost'}:
        pytest.fail('Image GC tests require local disposable PostgreSQL')
    admin = create_engine(url, isolation_level='AUTOCOMMIT')
    name = 'image_gc_test_' + uuid.uuid4().hex
    with admin.connect() as c:
        c.execute(text(f'CREATE DATABASE {name}'))
        c.execute(text("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='koma_app') THEN CREATE ROLE koma_app; END IF; END $$"))
    engine = create_engine(url.set(database=name))
    try:
        metadata = MetaData()
        for model in (Restaurante, Categoria, Produto):
            model.__table__.to_metadata(metadata)
        metadata.create_all(engine)
        spec = importlib.util.spec_from_file_location('retention_migration', Path(__file__).parents[1] / 'alembic/versions/e2f3a4b5c6d7_product_image_retention.py')
        migration = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(migration)
        with engine.begin() as c:
            with Operations.context(MigrationContext.configure(c)):
                migration.upgrade()
            c.execute(text('GRANT USAGE ON SCHEMA public, koma_internal TO koma_app'))
            c.execute(text('GRANT SELECT, INSERT, UPDATE, DELETE ON produtos TO koma_app'))
            c.execute(text('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO koma_app'))
            c.execute(text('ALTER TABLE produtos ENABLE ROW LEVEL SECURITY'))
            c.execute(text('ALTER TABLE produtos FORCE ROW LEVEL SECURITY'))
            c.execute(text("CREATE POLICY image_test_tenant ON produtos USING (restaurante_id = current_setting('app.current_restaurante_id')::int) WITH CHECK (restaurante_id = current_setting('app.current_restaurante_id')::int)"))
        with Session(engine) as db:
            db.add_all([Restaurante(id=t, nome=str(t)) for t in (1, 2)])
            db.flush()
            db.add_all([Categoria(id='c', nome='C', restaurante_id=t) for t in (1, 2)])
            db.commit()
        yield engine
    finally:
        engine.dispose()
        with admin.connect() as c:
            c.execute(text(f'DROP DATABASE {name} WITH (FORCE)'))
        admin.dispose()


def add_product(pg, ident='p', tenant=1, image='1/products/old.png', gallery=None):
    with Session(pg) as db:
        db.add(Produto(id=ident, restaurante_id=tenant, categoria_id='c', nome=ident,
                       preco=1, imagem=image, imagens_galeria=gallery or []))
        db.commit()


def replace(pg, image='1/products/new.webp'):
    with pg.begin() as c:
        c.execute(text('UPDATE produtos SET imagem=:image WHERE id=\'p\''), {'image': image})


def due(pg):
    with pg.begin() as c:
        c.execute(text('UPDATE product_image_retirements SET eligible_after=:now'), {'now': NOW})


def gc_as_app(pg, client, execute=True):
    with pg.connect() as c:
        c.execute(text('SET ROLE koma_app'))
        c.commit()
        try:
            with TenantSession(bind=c) as db, tenant_session_scope(db, 1):
                return collect(db, 1, now=NOW, execute=execute, client=client)
        finally:
            c.rollback()
            c.execute(text('RESET ROLE'))
            c.commit()


def test_trigger_captures_bulk_writes_gallery_removal_and_rollback(pg):
    add_product(pg, gallery=['1/products/gallery.png'])
    with pg.begin() as c:
        c.execute(text("UPDATE produtos SET imagem='1/products/new.webp', imagens_galeria='[]' WHERE id='p'"))
    with pg.connect() as c:
        rows = c.execute(text('SELECT object_path, eligible_after-retired_at FROM product_image_retirements')).all()
        assert set(r[0] for r in rows) == {'1/products/old.png', '1/products/gallery.png'}
        assert all(r[1] == timedelta(days=7) for r in rows)
    with pg.connect() as c:
        c.execute(text("UPDATE produtos SET imagem='1/products/rolled-back.webp' WHERE id='p'"))
        c.rollback()
        assert c.execute(text("SELECT count(*) FROM product_image_retirements WHERE object_path='1/products/new.webp'")).scalar() == 0


def test_rls_and_global_encoded_gallery_reference_are_protected(pg):
    add_product(pg)
    replace(pg)
    # An accidental legacy reference in another tenant must remain protected,
    # including percent-encoded filename aliases hidden by normal RLS.
    add_product(pg, 'foreign', 2, '', ['https://x/storage/v1/object/public/cardapio-assets/1/products/%6fld.png'])
    due(pg)
    calls = []
    with httpx.Client(base_url='https://test', transport=httpx.MockTransport(lambda r: calls.append(r) or httpx.Response(200))) as client:
        assert gc_as_app(pg, client)[0]['result'] == 'referenced'
    assert not calls
    with pg.connect() as c:
        c.execute(text('SET ROLE koma_app'))
        c.execute(text("SELECT set_config('app.current_restaurante_id','2',true)"))
        assert c.execute(text('SELECT count(*) FROM product_image_retirements')).scalar() == 0
        with pytest.raises(Exception, match='Invalid image lifecycle scope'):
            c.execute(text("SELECT koma_internal.product_image_referenced(1,'1/products/old.png')"))


def test_gc_fences_concurrent_restore_and_commits_tombstone(pg):
    add_product(pg)
    replace(pg)
    due(pg)
    started, done = threading.Event(), threading.Event()
    outcome = []
    def restore():
        started.set()
        try:
            replace(pg, '1/products/old.png')
        except Exception as exc:
            outcome.append(str(exc))
        finally:
            done.set()
    thread = threading.Thread(target=restore)
    def delete(request):
        # Durable intent is visible from another connection BEFORE remote DELETE.
        with pg.connect() as c:
            assert c.execute(text("SELECT state FROM product_image_retirements WHERE object_path='1/products/old.png'")).scalar() == 'deleting'
        thread.start()
        assert started.wait(2)
        assert done.wait(2)  # Durable intent rejects restore without waiting on the network.
        return httpx.Response(204)
    with httpx.Client(base_url='https://test', transport=httpx.MockTransport(delete)) as client:
        assert gc_as_app(pg, client)[0]['result'] == 'deleted'
    thread.join(5)
    assert done.is_set() and any('already retired' in value for value in outcome)
    with pg.connect() as c:
        assert c.execute(text("SELECT imagem FROM produtos WHERE id='p'")).scalar() == '1/products/new.webp'


def test_two_concurrent_replacements_capture_intermediate_object(pg):
    add_product(pg)
    errors = []
    def change(path):
        try:
            replace(pg, path)
        except Exception as exc:
            errors.append(exc)
    threads = [threading.Thread(target=change, args=(f'1/products/{name}.webp',)) for name in ('first', 'second')]
    for t in threads: t.start()
    for t in threads: t.join(5)
    assert not errors and all(not t.is_alive() for t in threads)
    with pg.connect() as c:
        active = c.execute(text("SELECT imagem FROM produtos WHERE id='p'")).scalar()
        retired = set(c.execute(text('SELECT object_path FROM product_image_retirements')).scalars())
        assert '1/products/old.png' in retired and len(retired) == 2 and active not in retired
    due(pg)
    calls = []
    with httpx.Client(base_url='https://test', transport=httpx.MockTransport(lambda r: calls.append(r) or httpx.Response(404))) as client:
        gc_as_app(pg, client)
        assert gc_as_app(pg, client) == []
    assert len(calls) == 2 and all(active.encode() not in r.content for r in calls)


def test_parallel_collectors_delete_each_object_once(pg):
    add_product(pg)
    replace(pg)
    due(pg)
    entered, release = threading.Event(), threading.Event()
    calls, errors = [], []
    def remote(request):
        calls.append(request)
        entered.set()
        assert release.wait(5)
        return httpx.Response(200)
    def first():
        try:
            with httpx.Client(base_url='https://test', transport=httpx.MockTransport(remote)) as client:
                gc_as_app(pg, client)
        except Exception as exc:
            errors.append(exc)
    thread = threading.Thread(target=first)
    thread.start()
    try:
        assert entered.wait(5)
        with httpx.Client(base_url='https://test', transport=httpx.MockTransport(remote)) as client:
            assert gc_as_app(pg, client) == []
    finally:
        release.set()
        thread.join(5)
    assert not errors and not thread.is_alive() and len(calls) == 1
