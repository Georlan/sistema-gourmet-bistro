import asyncio
from datetime import datetime, timedelta
from io import BytesIO
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import BackgroundTasks, UploadFile
from PIL import Image
from sqlalchemy import create_engine, MetaData
from sqlalchemy.orm import Session
from starlette.datastructures import Headers

from app.config import settings
from app.database import current_restaurante_id
from app.models import Restaurante, Categoria, Produto, ProductImageRetirement
from app.services.product_image_lifecycle import collect, enqueue, reconcile, list_product_objects
from app.services.storage_paths import storage_object_path

NOW = datetime(2026, 10, 4, 12)


@pytest.fixture
def db(monkeypatch):
    monkeypatch.setattr(settings, 'SUPABASE_URL', 'https://test.supabase.co')
    engine = create_engine('sqlite://')
    metadata = MetaData()
    for model in (Restaurante, Categoria, Produto, ProductImageRetirement):
        model.__table__.to_metadata(metadata)
    metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as session:
        session.add_all([Restaurante(id=1, nome='A'), Restaurante(id=2, nome='B')])
        session.flush()
        session.add_all([Categoria(id='c', nome='C', restaurante_id=t) for t in (1, 2)])
        session.commit()
        yield session
    engine.dispose()


def url(path):
    return f'https://test.supabase.co/storage/v1/object/public/cardapio-assets/{path}'


def product(db, ident='p', tenant=1, image='1/products/old.png', gallery=None):
    p = Produto(id=ident, restaurante_id=tenant, categoria_id='c', nome=ident, preco=1,
                imagem=url(image) if image else '', imagens_galeria=gallery or [])
    db.add(p)
    db.commit()
    return p


def retire(db, path='1/products/old.png', tenant=1, days=8):
    row = enqueue(db, tenant, path, now=NOW - timedelta(days=days))
    db.commit()
    return row


def remote(code=200, error=None):
    calls = []
    def handle(request):
        calls.append(request)
        if error:
            raise error
        return httpx.Response(code, json={})
    return httpx.Client(base_url='https://test.supabase.co', transport=httpx.MockTransport(handle)), calls


def test_upload_replaces_and_enqueues_without_remote_delete(db, monkeypatch):
    from app.routes import cardapio_digital as route
    p = product(db, gallery=[url('1/products/gallery.png')])
    buffer = BytesIO()
    Image.new('RGB', (40, 30)).save(buffer, format='PNG')
    post = AsyncMock(return_value=httpx.Response(201))
    monkeypatch.setattr(httpx.AsyncClient, 'post', post)
    monkeypatch.setattr(route, '_supabase_storage_headers', lambda *args: {})
    token = current_restaurante_id.set(1)
    try:
        result = asyncio.run(route.upload_product_asset('p', BackgroundTasks(),
            UploadFile(BytesIO(buffer.getvalue()), filename='../../attack.png',
                       headers=Headers({'content-type': 'image/png'})), db, None))
    finally:
        current_restaurante_id.reset(token)
    assert result['imagem'].endswith('.webp') and result['imagem'] != url('1/products/old.png')
    assert result['imagens_galeria'] == []
    rows = db.query(ProductImageRetirement).all()
    assert {r.object_path for r in rows} == {'1/products/old.png', '1/products/gallery.png'}
    assert all(r.eligible_after - r.retired_at == timedelta(days=7) for r in rows)
    assert post.call_count == 1


def test_before_deadline_does_not_delete(db):
    retire(db, days=6)
    client, calls = remote()
    assert collect(db, 1, execute=True, now=NOW, client=client) == []
    assert not calls


@pytest.mark.parametrize('code', [200, 204, 404])
def test_due_unreferenced_deleted_idempotently(db, code):
    row = retire(db)
    client, calls = remote(code)
    assert collect(db, 1, execute=True, now=NOW, client=client)[0]['result'] == 'deleted'
    assert row.state == 'deleted'
    assert collect(db, 1, execute=True, now=NOW, client=client) == []
    assert len(calls) == 1
    with pytest.raises(ValueError, match='exclusão'):
        product(db)
    db.rollback()


@pytest.mark.parametrize('gallery', [False, True])
def test_reference_and_shared_products_protect_object(db, gallery):
    p = product(db, image=None if gallery else '1/products/old.png',
                gallery=[url('1/products/old.png')] if gallery else [])
    product(db, ident='second')
    row = retire(db)
    client, calls = remote()
    assert collect(db, 1, execute=True, now=NOW, client=client)[0]['result'] == 'referenced'
    assert not calls and row.state == 'pending'
    p.imagem, p.imagens_galeria = '', []
    db.commit()
    row.eligible_after = NOW - timedelta(seconds=1)
    db.commit()
    assert collect(db, 1, execute=True, now=NOW, client=client)[0]['result'] == 'referenced'
    assert not calls


def test_tenant_isolation_and_legacy_foreign_reference(db):
    retire(db)
    retire(db, path='2/products/b.png', tenant=2)
    product(db, tenant=2)  # legacy accidental cross-tenant reference is protected too
    client, calls = remote()
    assert collect(db, 1, execute=True, now=NOW, client=client)[0]['result'] == 'referenced'
    assert not calls
    assert collect(db, 2, execute=True, now=NOW, client=client)[0]['object_path'] == '2/products/b.png'
    assert len(calls) == 1


@pytest.mark.parametrize('path', ['2/products/a.png', '1/products/../a.png', '1/products/%252e%252e/a',
    '1/products/%2e%2e/a', '1/banner/a.png', '1/products/a/b.png', '1/products/a\\b.png',
    'https://evil.invalid/storage/v1/object/public/cardapio-assets/1/products/a.png'])
def test_unsafe_paths_never_delete(db, path):
    assert storage_object_path(path, 1, 'products') is None
    db.add(ProductImageRetirement(restaurante_id=1, object_path=path, retired_at=NOW,
        eligible_after=NOW, state='pending', reason='legacy', attempts=0))
    db.commit()
    client, calls = remote()
    assert collect(db, 1, execute=True, now=NOW, client=client)[0]['result'] == 'invalid_path'
    assert not calls


@pytest.mark.parametrize('code,error', [(503, None), (200, httpx.ConnectError('temporary'))])
def test_remote_failures_keep_durable_candidate_for_retry(db, code, error):
    row = retire(db)
    client, calls = remote(code, error)
    assert collect(db, 1, execute=True, now=NOW, client=client)[0]['result'] == 'retry'
    assert row.state == 'deleting' and row.attempts == 1
    assert collect(db, 1, execute=True, now=NOW, client=client) == []
    client, calls = remote(404)
    collect(db, 1, execute=True, now=NOW + timedelta(hours=2), client=client)
    assert row.state == 'deleted'


def test_multiple_replacements_and_restore_restart_retention(db):
    p = product(db)
    p.imagem = url('1/products/next.webp')
    db.commit()
    p.imagem = url('1/products/final.webp')
    db.commit()
    assert {r.object_path for r in db.query(ProductImageRetirement)} == {'1/products/old.png', '1/products/next.webp'}
    for r in db.query(ProductImageRetirement):
        r.eligible_after = NOW
    p.imagem = url('1/products/old.png')
    db.commit()
    client, calls = remote()
    collect(db, 1, execute=True, now=NOW, client=client)
    assert len(calls) == 1 and b'next.webp' in calls[0].content
    p.imagem = url('1/products/new.webp')
    db.commit()
    old = db.query(ProductImageRetirement).filter_by(object_path='1/products/old.png').one()
    assert old.eligible_after >= datetime.utcnow() + timedelta(days=6)


def test_dry_run_does_not_mutate_or_delete(db):
    row = retire(db)
    client, calls = remote()
    assert collect(db, 1, now=NOW, client=client)[0]['result'] == 'eligible'
    assert not calls and row.state == 'pending' and row.attempts == 0


def test_reconcile_legacy_gallery_age_and_fresh_observation_window(db):
    product(db, image=None, gallery=[url('1/products/gallery.png')])
    def obj(name, days, size):
        return {'id': name, 'name': name, 'created_at': (NOW - timedelta(days=days)).isoformat()+'Z', 'metadata': {'size': size}}
    objects = [obj('old.png', 30, 1234), obj('gallery.png', 40, 444), obj('new.webp', 2, 22), obj('../evil', 40, 999)]
    report = reconcile(db, 1, objects, now=NOW)
    assert report['summary'] == {'candidates': 1, 'recoverable_bytes_after_retention': 1234, 'protected_by_retention': 1, 'referenced': 1}
    assert db.query(ProductImageRetirement).count() == 0
    reconcile(db, 1, objects, execute=True, now=NOW)
    row = db.query(ProductImageRetirement).one()
    assert row.eligible_after == NOW + timedelta(days=7)
    reconcile(db, 1, objects, execute=True, now=NOW + timedelta(days=1))
    assert row.eligible_after == NOW + timedelta(days=7)
    client, calls = remote()
    assert collect(db, 1, execute=True, now=NOW, client=client) == []
    assert not calls


def test_delete_endpoint_clears_gallery_and_enqueues_shared_object(db):
    from app.routes.cardapio_digital import delete_product_asset
    p = product(db, gallery=[url('1/products/gallery.png')])
    product(db, ident='shared')
    token = current_restaurante_id.set(1)
    try:
        tasks = BackgroundTasks()
        result = asyncio.run(delete_product_asset('p', tasks, db, None))
    finally:
        current_restaurante_id.reset(token)
    assert result['imagem'] == '' and p.imagens_galeria == []
    assert db.query(ProductImageRetirement).count() == 2
    assert all('delete' not in t.func.__name__ for t in tasks.tasks)


def test_inventory_pagination_is_tenant_scoped():
    calls = []
    def handle(request):
        import json
        payload = json.loads(request.content)
        calls.append(payload)
        assert payload['prefix'] == '6/products/'
        return httpx.Response(200, json=[{'name': str(i)} for i in range(100)] if payload['offset'] == 0 else [])
    with httpx.Client(base_url='https://test.supabase.co', transport=httpx.MockTransport(handle)) as client:
        assert len(list(list_product_objects(client, 6))) == 100
    assert [r['offset'] for r in calls] == [0, 100]


def test_migration_lineage_has_one_resolvable_head():
    from alembic.config import Config
    from alembic.script import ScriptDirectory
    from pathlib import Path
    root = Path(__file__).resolve().parents[2]
    config = Config(str(root / 'backend/alembic.ini'))
    config.set_main_option('script_location', str(root / 'backend/alembic'))
    script = ScriptDirectory.from_config(config)
    assert len(script.get_heads()) == 1
    assert script.get_revision('82c7a941d5ef') is not None
