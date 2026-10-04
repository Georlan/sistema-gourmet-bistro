"""Seven-day retention, conservative reference checks and retryable Storage GC."""
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import logging
import threading
from urllib.parse import unquote

import httpx
from sqlalchemy import select, text
from ..config import settings
from ..models import Produto, ProductImageRetirement
from .storage_paths import storage_object_path

RETENTION = timedelta(days=7)
LOCK_KEY = 1263488321
logger = logging.getLogger('koma.product_image_lifecycle')
_local_lock = threading.RLock()


def product_urls(product):
    return [product.imagem or '', *(product.imagens_galeria or [])]


def enqueue(db, tenant, path, *, now=None, reason='replaced'):
    now = now or datetime.now(timezone.utc).replace(tzinfo=None)
    if storage_object_path(path, tenant, 'products') != path:
        return None
    row = next((r for r in db.new if isinstance(r, ProductImageRetirement)
                and r.restaurante_id == tenant and r.object_path == path), None)
    if row is None:
        row = db.query(ProductImageRetirement).filter_by(restaurante_id=tenant, object_path=path).first()
    if row is None:
        row = ProductImageRetirement(restaurante_id=tenant, object_path=path, state='pending', attempts=0)
        db.add(row)
    if row.state == 'pending':
        row.retired_at, row.eligible_after, row.reason = now, now + RETENTION, reason
    return row


def sqlite_track_changes(db):
    """Portable ORM counterpart of the PostgreSQL trigger (local/test SQLite only)."""
    if db.get_bind().dialect.name != 'sqlite':
        return
    for product in list(db.new) + list(db.dirty) + list(db.deleted):
        if not isinstance(product, Produto):
            continue
        tenant = product.restaurante_id
        if tenant is None:
            from ..database import _effective_tenant_id
            tenant = _effective_tenant_id(db)
        if not tenant:
            continue
        old = db.connection().execute(select(Produto.__table__.c.imagem, Produto.__table__.c.imagens_galeria)
                                      .where(Produto.pk == product.pk)).first() if product.pk else None
        new_urls = [] if product in db.deleted else product_urls(product)
        for url in new_urls:
            path = storage_object_path(url, tenant, 'products')
            if path:
                tombstone = db.query(ProductImageRetirement).filter_by(restaurante_id=tenant, object_path=path).first()
                if tombstone and tombstone.state in {'deleting', 'deleted'}:
                    raise ValueError('A imagem já entrou em exclusão; envie uma nova foto.')
        if old:
            new_paths = {storage_object_path(url, tenant, 'products') for url in new_urls}
            for url in [old.imagem, *(old.imagens_galeria or [])]:
                path = storage_object_path(url, tenant, 'products')
                if path and path not in new_paths:
                    enqueue(db, tenant, path)


@contextmanager
def deletion_lock(db):
    """Transaction lock matches the trigger and works with transaction poolers.

    Durable deletion intent fences reattachment after commit, so no connection
    or global lock is held during the external request.
    """
    if db.get_bind().dialect.name == 'postgresql':
        db.execute(text('SELECT pg_advisory_xact_lock(:key)'), {'key': LOCK_KEY})
        try:
            yield
        finally:
            db.rollback()
    else:
        with _local_lock:
            yield


def referenced(db, tenant, path):
    # Conservative filename match also protects encoded/legacy aliases and accidental
    # cross-tenant references. False positives retain bytes; they never delete an image.
    filename = path.rsplit('/', 1)[-1]
    if db.get_bind().dialect.name == 'postgresql':
        return bool(db.execute(text('SELECT koma_internal.product_image_referenced(:tenant, :path)'),
                               {'tenant': tenant, 'path': path}).scalar_one())
    # SQLite has no RLS; use Core so TenantSession filtering cannot hide shared references.
    for image, gallery in db.connection().execute(select(Produto.__table__.c.imagem, Produto.__table__.c.imagens_galeria)):
        if any(filename in unquote(str(url)) for url in [image or '', *(gallery or [])]):
            return True
    return False


def storage_client():
    if not settings.SUPABASE_URL or not settings.SUPABASE_SERVICE_ROLE_KEY:
        raise RuntimeError('Storage não configurado')
    return httpx.Client(base_url=settings.SUPABASE_URL.rstrip('/'), timeout=10, trust_env=False,
                        headers={'Authorization': f'Bearer {settings.SUPABASE_SERVICE_ROLE_KEY}',
                                 'apikey': settings.SUPABASE_SERVICE_ROLE_KEY})


def collect(db, tenant, *, execute=False, now=None, client=None, limit=25):
    now = now or datetime.now(timezone.utc).replace(tzinfo=None)
    results = []
    ids = [ident for (ident,) in db.query(ProductImageRetirement.id).filter(
        ProductImageRetirement.restaurante_id == tenant,
        ProductImageRetirement.state.in_(['pending', 'deleting']),
        ProductImageRetirement.eligible_after <= now,
    ).order_by(ProductImageRetirement.eligible_after, ProductImageRetirement.id).limit(limit).all()]
    db.rollback()
    for ident in ids:
        with deletion_lock(db):
            row = db.query(ProductImageRetirement).filter_by(id=ident, restaurante_id=tenant).populate_existing().with_for_update().first()
            # Revalidate the claim after waiting for another collector/writer.
            if not row or row.state not in {'pending', 'deleting'} or row.eligible_after > now:
                continue
            path = row.object_path
            if storage_object_path(path, tenant, 'products') != path:
                results.append({'tenant': tenant, 'object_path': path, 'result': 'invalid_path'})
                continue
            if referenced(db, tenant, path):
                results.append({'tenant': tenant, 'object_path': path, 'result': 'referenced'})
                if execute:
                    row.eligible_after = now + RETENTION
                    row.last_result = 'referenced'
                    db.commit()
                continue
            result = {'tenant': tenant, 'object_path': path, 'result': 'eligible'}
            results.append(result)
            if not execute:
                continue
            row.state = 'deleting'
            row.attempts += 1
            row.eligible_after = now + timedelta(hours=1)
            row.last_result = 'delete_intent'
            db.commit()  # Crash-safe fence; no writer can reattach this object now.
        try:
            owned_client = client is None
            remote = client or storage_client()
            try:
                response = remote.request('DELETE', '/storage/v1/object/cardapio-assets', json={'prefixes': [path]})
            finally:
                if owned_client:
                    remote.close()
            if response.status_code not in {200, 204, 404}:
                raise RuntimeError(f'http_{response.status_code}')
        except (httpx.HTTPError, RuntimeError) as exc:
            row.last_result = type(exc).__name__ if isinstance(exc, httpx.HTTPError) else str(exc)
            result['result'] = 'retry'
            logger.warning('Image GC retry tenant=%s path=%s result=%s', tenant, path, row.last_result)
        else:
            row.state, row.deleted_at, row.last_result = 'deleted', now, 'deleted'
            result['result'] = 'deleted'
        db.commit()
    return results


def reconcile(db, tenant, objects, *, min_age_days=7, execute=False, now=None):
    """Inventory-only by default. --execute enrolls orphans, never deletes them.

    Even old objects receive a fresh seven-day observation window at enrollment.
    """
    if min_age_days < 7:
        raise ValueError('A idade mínima deve ser pelo menos 7 dias')
    now = now or datetime.now(timezone.utc).replace(tzinfo=None)
    rows = []
    with deletion_lock(db):
        for obj in objects:
            name = obj.get('name', '')
            path = f'{tenant}/products/{name}'
            if storage_object_path(path, tenant, 'products') != path or not obj.get('id'):
                continue  # folder or malformed listing entry
            try:
                created = datetime.fromisoformat(obj['created_at'].replace('Z', '+00:00'))
                if created.tzinfo is not None:
                    created = created.astimezone(timezone.utc).replace(tzinfo=None)
            except (KeyError, TypeError, ValueError):
                continue  # unknown age fails closed
            age = (now - created).total_seconds() / 86400
            used = referenced(db, tenant, path)
            eligible = not used and age >= min_age_days
            rows.append({'tenant': tenant, 'object_path': path, 'size': int((obj.get('metadata') or {}).get('size') or 0),
                         'created_at': created.isoformat(), 'age_days': round(age, 2), 'referenced': used,
                         'eligible': eligible, 'reason': 'referenced' if used else 'legacy_orphan' if eligible else 'retention'})
            if execute and eligible:
                # Do not restart the observation window on repeated inventory runs.
                exists = db.query(ProductImageRetirement).filter_by(restaurante_id=tenant, object_path=path).first()
                if not exists:
                    enqueue(db, tenant, path, now=now, reason='legacy_orphan')
        if execute:
            db.commit()
    return {'objects': rows, 'summary': {'candidates': sum(r['eligible'] for r in rows),
            'recoverable_bytes_after_retention': sum(r['size'] for r in rows if r['eligible']),
            'protected_by_retention': sum(not r['referenced'] and not r['eligible'] for r in rows),
            'referenced': sum(r['referenced'] for r in rows)}}


def list_product_objects(client, tenant):
    offset = 0
    while True:
        response = client.post('/storage/v1/object/list/cardapio-assets', json={
            'prefix': f'{tenant}/products/', 'limit': 100, 'offset': offset,
            'sortBy': {'column': 'name', 'order': 'asc'}})
        response.raise_for_status()
        page = response.json()
        if not isinstance(page, list):
            raise RuntimeError('Resposta de inventário inválida')
        yield from page
        if len(page) < 100:
            break
        offset += len(page)


def run_tenant(tenant, *, mode='collect', execute=False, min_age_days=7):
    from ..database import engine, TenantSession, tenant_session_scope
    with engine.connect() as connection, TenantSession(bind=connection) as db:
        with tenant_session_scope(db, tenant):
            if mode == 'collect':
                return collect(db, tenant, execute=execute)
            with storage_client() as client:
                objects = list(list_product_objects(client, tenant))
            return reconcile(db, tenant, objects, min_age_days=min_age_days, execute=execute)
