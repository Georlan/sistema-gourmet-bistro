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


def list_tenant_objects(client, tenant, category='products'):
    offset = 0
    while True:
        response = client.post('/storage/v1/object/list/cardapio-assets', json={
            'prefix': f'{tenant}/{category}/', 'limit': 100, 'offset': offset,
            'sortBy': {'column': 'name', 'order': 'asc'}})
        response.raise_for_status()
        page = response.json()
        if not isinstance(page, list):
            raise RuntimeError('Resposta de inventário inválida')
        yield from page
        if len(page) < 100:
            break
        offset += len(page)


def list_product_objects(client, tenant):
    yield from list_tenant_objects(client, tenant, 'products')


def _estimate_webp_savings(size_bytes: int, ext: str, category: str) -> int:
    from .image_optimization import IMAGE_BUDGETS
    budget = IMAGE_BUDGETS.get(category, IMAGE_BUDGETS['products'])
    ext_lower = ext.lower().lstrip('.')
    if ext_lower == 'png':
        target = min(budget.max_bytes, max(12 * 1024, int(size_bytes * 0.10)))
        return max(0, size_bytes - target)
    if ext_lower in {'jpg', 'jpeg'}:
        target = min(budget.max_bytes, max(12 * 1024, int(size_bytes * 0.28)))
        return max(0, size_bytes - target)
    if ext_lower == 'webp' and size_bytes > budget.max_bytes:
        return size_bytes - budget.max_bytes
    return 0


def inventory(
    db,
    tenant: int,
    objects_by_category: dict[str, list[dict]] | None = None,
    *,
    min_age_days: int = 7,
    now: datetime | None = None,
    client: httpx.Client | None = None,
) -> dict:
    """Comprehensive non-destructive inventory for a tenant across products, logo, and banner."""
    from ..models import Restaurante
    now = now or datetime.now(timezone.utc).replace(tzinfo=None)
    if objects_by_category is None:
        owned_client = client is None
        remote = client or storage_client()
        try:
            objects_by_category = {
                cat: list(list_tenant_objects(remote, tenant, cat))
                for cat in ('products', 'logo', 'banner')
            }
        finally:
            if owned_client:
                remote.close()

    products = db.query(Produto).filter(Produto.restaurante_id == tenant).all()
    restaurante = db.query(Restaurante).filter(Restaurante.id == tenant).first()
    retirements = {
        r.object_path: r
        for r in db.query(ProductImageRetirement).filter_by(restaurante_id=tenant).all()
    }

    primary_refs: dict[str, list[str]] = {}
    gallery_refs: dict[str, list[str]] = {}
    for prod in products:
        p_path = storage_object_path(prod.imagem, tenant, 'products')
        if p_path:
            primary_refs.setdefault(p_path, []).append(str(prod.id))
        for g_url in (prod.imagens_galeria or []):
            g_path = storage_object_path(g_url, tenant, 'products')
            if g_path:
                gallery_refs.setdefault(g_path, []).append(str(prod.id))

    logo_path = (
        storage_object_path(restaurante.logo_url or restaurante.cardapio_logo_path, tenant, 'logo')
        if restaurante else None
    )
    banner_path = (
        storage_object_path(restaurante.banner_url or restaurante.cardapio_banner_path, tenant, 'banner')
        if restaurante else None
    )

    items: list[dict] = []
    by_category: dict[str, dict] = {}
    by_month: dict[str, dict[str, int]] = {}

    for category in ('products', 'logo', 'banner'):
        cat_objs = objects_by_category.get(category) or []
        cat_sizes: list[int] = []
        cat_in_use = 0
        cat_orphan = 0
        cat_indeterminate = 0
        cat_savings = 0
        for obj in cat_objs:
            name = obj.get('name', '')
            path = f'{tenant}/{category}/{name}'
            if storage_object_path(path, tenant, category) != path or not obj.get('id'):
                continue
            meta = obj.get('metadata') or {}
            size_bytes = int(meta.get('size') or 0)
            mimetype = str(meta.get('mimetype') or '')
            ext = name.rsplit('.', 1)[-1].lower() if '.' in name else ''
            created_raw = obj.get('created_at')
            created_dt = None
            age_days = None
            if isinstance(created_raw, str):
                try:
                    created_dt = datetime.fromisoformat(created_raw.replace('Z', '+00:00'))
                    if created_dt.tzinfo is not None:
                        created_dt = created_dt.astimezone(timezone.utc).replace(tzinfo=None)
                    age_days = round((now - created_dt).total_seconds() / 86400, 2)
                except ValueError:
                    created_dt = None

            p_ids = primary_refs.get(path, [])
            g_ids = gallery_refs.get(path, [])
            is_logo = (category == 'logo' and path == logo_path)
            is_banner = (category == 'banner' and path == banner_path)
            global_ref = referenced(db, tenant, path) if category == 'products' else (is_logo or is_banner)
            ref_count = len(set(p_ids + g_ids)) + (1 if is_logo else 0) + (1 if is_banner else 0)
            in_use = bool(ref_count > 0 or global_ref)

            ret = retirements.get(path)
            if in_use:
                status_label = 'in_use'
                retention_state = 'active'
                cat_in_use += 1
            elif created_dt is None:
                status_label = 'indeterminate'
                retention_state = 'unknown_age'
                cat_indeterminate += 1
            elif ret is not None:
                status_label = 'orphan'
                retention_state = f'retirement_{ret.state}'
                cat_orphan += 1
            elif age_days is not None and age_days < min_age_days:
                status_label = 'indeterminate'
                retention_state = 'grace_period_under_7d'
                cat_indeterminate += 1
            else:
                status_label = 'orphan'
                retention_state = 'unreferenced_eligible_for_retention'
                cat_orphan += 1

            # Rule 3: orphans save their entire size after 7-day retention; in-use files save via WebP conversion.
            potential_savings = (
                size_bytes
                if status_label == 'orphan'
                else (_estimate_webp_savings(size_bytes, ext, category) if in_use else 0)
            )
            cat_sizes.append(size_bytes)
            cat_savings += potential_savings

            if created_dt is not None:
                month_key = created_dt.strftime('%Y-%m')
                m_bucket = by_month.setdefault(month_key, {'count': 0, 'bytes': 0})
                m_bucket['count'] += 1
                m_bucket['bytes'] += size_bytes

            items.append({
                'tenant': tenant,
                'category': category,
                'object_path': path,
                'size_bytes': size_bytes,
                'format': ext or mimetype,
                'mimetype': mimetype,
                'width': meta.get('width'),
                'height': meta.get('height'),
                'created_at': created_dt.isoformat() if created_dt else None,
                'age_days': age_days,
                'status': status_label,
                'retention_state': retention_state,
                'reference_count': ref_count,
                'shared': ref_count > 1,
                'primary_product_ids': p_ids,
                'gallery_product_ids': g_ids,
                'is_logo': is_logo,
                'is_banner': is_banner,
                'potential_savings_bytes': potential_savings,
            })

        by_category[category] = {
            'count': len(cat_sizes),
            'total_bytes': sum(cat_sizes),
            'avg_bytes': int(round(sum(cat_sizes) / len(cat_sizes))) if cat_sizes else 0,
            'max_bytes': max(cat_sizes) if cat_sizes else 0,
            'in_use_count': cat_in_use,
            'orphan_count': cat_orphan,
            'indeterminate_count': cat_indeterminate,
            'potential_savings_bytes': cat_savings,
        }

    top_heaviest = sorted(items, key=lambda x: x['size_bytes'], reverse=True)[:20]
    total_bytes = sum(i['size_bytes'] for i in items)
    total_savings = sum(i['potential_savings_bytes'] for i in items)

    return {
        'tenant': tenant,
        'summary': {
            'total_objects': len(items),
            'total_bytes': total_bytes,
            'in_use_count': sum(1 for i in items if i['status'] == 'in_use'),
            'orphan_count': sum(1 for i in items if i['status'] == 'orphan'),
            'indeterminate_count': sum(1 for i in items if i['status'] == 'indeterminate'),
            'potential_savings_bytes': total_savings,
        },
        'by_category': by_category,
        'by_month': dict(sorted(by_month.items())),
        'top_heaviest': top_heaviest,
        'objects': items,
    }


def migrate_legacy_images(
    db,
    tenant: int,
    *,
    execute: bool = False,
    client: httpx.Client | None = None,
    categories: tuple[str, ...] = ('products', 'logo', 'banner'),
) -> dict:
    """Safely convert referenced PNG/JPG/over-budget bucket objects to canonical WebP.

    - Never converts unreferenced orphan objects (Rule 3).
    - Deduplicates shared paths and identical SHA-256 content within (tenant, category) (Rule 2 & 8).
    - Uploads new .webp object with immutable Cache-Control and validates readability before updating DB (Rule 2).
    - Old product objects are automatically enrolled into the 7-day retention queue via DB triggers (Rule 4 & 5).
    - Produces a complete recovery_map for instant rollback if needed (Rule 6).
    """
    import hashlib
    import uuid
    from urllib.parse import quote
    from ..models import Restaurante
    from .image_optimization import IMAGE_BUDGETS, InvalidImage, optimize_image

    owned_client = client is None
    remote = client or storage_client()
    storage_base = settings.SUPABASE_URL.rstrip('/')

    try:
        products = db.query(Produto).filter(Produto.restaurante_id == tenant).all()
        restaurante = db.query(Restaurante).filter(Restaurante.id == tenant).first()

        # Collect all referenced bucket paths and their DB bindings
        # Each binding: ('product_primary', prod_obj, old_url) | ('product_gallery', prod_obj, idx, old_url) | ('logo', rest, old_url) | ('banner', rest, old_url)
        bindings_by_path: dict[tuple[str, str], list[tuple]] = {}

        if 'products' in categories:
            for prod in products:
                p_path = storage_object_path(prod.imagem, tenant, 'products')
                if p_path:
                    bindings_by_path.setdefault(('products', p_path), []).append(
                        ('product_primary', prod, prod.imagem)
                    )
                for idx, g_url in enumerate(prod.imagens_galeria or []):
                    g_path = storage_object_path(g_url, tenant, 'products')
                    if g_path:
                        bindings_by_path.setdefault(('products', g_path), []).append(
                            ('product_gallery', prod, idx, g_url)
                        )

        if restaurante is not None:
            if 'logo' in categories:
                l_url = restaurante.logo_url or restaurante.cardapio_logo_path
                l_path = storage_object_path(l_url, tenant, 'logo')
                if l_path:
                    bindings_by_path.setdefault(('logo', l_path), []).append(
                        ('logo', restaurante, l_url)
                    )
            if 'banner' in categories:
                b_url = restaurante.banner_url or restaurante.cardapio_banner_path
                b_path = storage_object_path(b_url, tenant, 'banner')
                if b_path:
                    bindings_by_path.setdefault(('banner', b_path), []).append(
                        ('banner', restaurante, b_url)
                    )

        migrated_objects: list[dict] = []
        skipped_objects: list[dict] = []
        recovery_map: list[dict] = []
        # Deduplicate identical raw content within the same (category, sha256)
        uploaded_by_hash: dict[tuple[str, str], dict] = {}

        for (category, source_path), bindings in sorted(bindings_by_path.items()):
            ext = source_path.rsplit('.', 1)[-1].lower() if '.' in source_path else ''
            budget = IMAGE_BUDGETS[category]

            # Download object bytes from public/authenticated storage endpoint
            dl_path = f'/storage/v1/object/public/cardapio-assets/{quote(source_path, safe="/")}'
            response = remote.get(dl_path)
            if response.status_code != 200 or not response.content:
                skipped_objects.append({
                    'object_path': source_path,
                    'category': category,
                    'reason': f'download_failed_http_{response.status_code}',
                })
                continue

            raw_bytes = response.content
            bytes_before = len(raw_bytes)
            cache_control = response.headers.get('cache-control', '')
            needs_cache_fix = 'max-age=31536000' not in cache_control

            # Skip if already canonical WebP within budget and has proper immutable Cache-Control
            if ext == 'webp' and bytes_before <= budget.max_bytes and not needs_cache_fix:
                skipped_objects.append({
                    'object_path': source_path,
                    'category': category,
                    'bytes_before': bytes_before,
                    'reason': 'already_canonical_webp',
                })
                continue

            content_sha = hashlib.sha256(raw_bytes).hexdigest()
            dedup_entry = uploaded_by_hash.get((category, content_sha))

            if dedup_entry is not None:
                new_path = dedup_entry['new_object_path']
                new_url = dedup_entry['new_url']
                bytes_after = dedup_entry['bytes_after']
                width = dedup_entry['width']
                height = dedup_entry['height']
                reused_existing = True
            else:
                reused_existing = False
                try:
                    optimized = optimize_image(raw_bytes, category)
                except InvalidImage as exc:
                    skipped_objects.append({
                        'object_path': source_path,
                        'category': category,
                        'bytes_before': bytes_before,
                        'reason': f'invalid_image: {exc}',
                    })
                    continue

                bytes_after = len(optimized.content)
                width, height = optimized.width, optimized.height

                # Rule 1: Only convert if it reduces size, is non-WebP, or fixes missing Cache-Control / budget excess
                if ext == 'webp' and bytes_after >= bytes_before and bytes_before <= budget.max_bytes and not needs_cache_fix:
                    skipped_objects.append({
                        'object_path': source_path,
                        'category': category,
                        'bytes_before': bytes_before,
                        'bytes_after': bytes_after,
                        'reason': 'no_size_benefit',
                    })
                    continue

                new_path = f'{tenant}/{category}/{uuid.uuid4().hex}.{optimized.extension}'
                new_url = f'{storage_base}/storage/v1/object/public/cardapio-assets/{quote(new_path, safe="/")}'

                if execute:
                    up_resp = remote.post(
                        f'/storage/v1/object/cardapio-assets/{quote(new_path, safe="/")}',
                        headers={
                            'Content-Type': optimized.content_type,
                            'Cache-Control': 'max-age=31536000, immutable',
                            'x-upsert': 'false',
                        },
                        content=optimized.content,
                    )
                    if up_resp.status_code not in {200, 201}:
                        skipped_objects.append({
                            'object_path': source_path,
                            'category': category,
                            'bytes_before': bytes_before,
                            'reason': f'upload_failed_http_{up_resp.status_code}',
                        })
                        continue

                    # Rule 2: Validate that the newly uploaded object is readable before updating references
                    verify_resp = remote.get(
                        f'/storage/v1/object/public/cardapio-assets/{quote(new_path, safe="/")}'
                    )
                    if verify_resp.status_code != 200 or len(verify_resp.content) != bytes_after:
                        skipped_objects.append({
                            'object_path': source_path,
                            'category': category,
                            'bytes_before': bytes_before,
                            'reason': f'verification_failed_http_{verify_resp.status_code}',
                        })
                        continue

                uploaded_by_hash[(category, content_sha)] = {
                    'new_object_path': new_path,
                    'new_url': new_url,
                    'bytes_after': bytes_after,
                    'width': width,
                    'height': height,
                }

            affected_ids: list[str] = []
            for binding in bindings:
                kind_tag = binding[0]
                if kind_tag == 'product_primary':
                    _, prod_obj, old_url = binding
                    affected_ids.append(str(prod_obj.id))
                    recovery_map.append({
                        'target_type': 'product_primary',
                        'target_id': str(prod_obj.id),
                        'old_url': old_url,
                        'new_url': new_url,
                        'old_object_path': source_path,
                        'new_object_path': new_path,
                    })
                    if execute:
                        prod_obj.imagem = new_url
                elif kind_tag == 'product_gallery':
                    _, prod_obj, idx, old_url = binding
                    affected_ids.append(str(prod_obj.id))
                    recovery_map.append({
                        'target_type': 'product_gallery',
                        'target_id': str(prod_obj.id),
                        'gallery_index': idx,
                        'old_url': old_url,
                        'new_url': new_url,
                        'old_object_path': source_path,
                        'new_object_path': new_path,
                    })
                    if execute:
                        gal = list(prod_obj.imagens_galeria or [])
                        if 0 <= idx < len(gal):
                            gal[idx] = new_url
                            prod_obj.imagens_galeria = gal
                elif kind_tag == 'logo':
                    _, rest_obj, old_url = binding
                    affected_ids.append(f'restaurante:{rest_obj.id}:logo')
                    recovery_map.append({
                        'target_type': 'logo',
                        'target_id': str(rest_obj.id),
                        'old_url': old_url,
                        'new_url': new_url,
                        'old_object_path': source_path,
                        'new_object_path': new_path,
                    })
                    if execute:
                        rest_obj.logo_url = new_url
                        rest_obj.cardapio_logo_path = new_path
                elif kind_tag == 'banner':
                    _, rest_obj, old_url = binding
                    affected_ids.append(f'restaurante:{rest_obj.id}:banner')
                    recovery_map.append({
                        'target_type': 'banner',
                        'target_id': str(rest_obj.id),
                        'old_url': old_url,
                        'new_url': new_url,
                        'old_object_path': source_path,
                        'new_object_path': new_path,
                    })
                    if execute:
                        rest_obj.banner_url = new_url
                        rest_obj.cardapio_banner_path = new_path

            effective_after = 0 if reused_existing else bytes_after
            migrated_objects.append({
                'category': category,
                'old_object_path': source_path,
                'new_object_path': new_path,
                'new_url': new_url,
                'bytes_before': bytes_before,
                'bytes_after': bytes_after,
                'effective_storage_bytes_after': effective_after,
                'saved_bytes': bytes_before - effective_after,
                'width': width,
                'height': height,
                'deduplicated_reuse': reused_existing,
                'reference_count': len(bindings),
                'affected_targets': affected_ids,
            })

        if execute and migrated_objects:
            db.commit()
        else:
            db.rollback()

        total_before = sum(m['bytes_before'] for m in migrated_objects)
        total_after = sum(m['effective_storage_bytes_after'] for m in migrated_objects)
        return {
            'tenant': tenant,
            'executed': execute,
            'summary': {
                'migrated_objects_count': len(migrated_objects),
                'skipped_objects_count': len(skipped_objects),
                'updated_references_count': len(recovery_map),
                'bytes_before': total_before,
                'bytes_after': total_after,
                'saved_bytes': total_before - total_after,
                'reduction_pct': round((1 - (total_after / total_before)) * 100, 2) if total_before else 0.0,
            },
            'migrated_objects': migrated_objects,
            'skipped_objects': skipped_objects,
            'recovery_map': recovery_map,
        }
    finally:
        if owned_client:
            remote.close()


def restore_migrated_references(db, tenant: int, recovery_map: list[dict], *, execute: bool = False) -> dict:
    """Restore previous URLs from a migration recovery_map within the 7-day retention window."""
    from ..models import Restaurante
    restored = 0
    for entry in recovery_map:
        ttype = entry.get('target_type')
        tid = entry.get('target_id')
        old_url = entry.get('old_url')
        old_path = entry.get('old_object_path')
        if ttype == 'product_primary':
            prod = db.query(Produto).filter_by(restaurante_id=tenant, id=tid).first()
            if prod and old_url:
                if execute:
                    prod.imagem = old_url
                restored += 1
        elif ttype == 'product_gallery':
            prod = db.query(Produto).filter_by(restaurante_id=tenant, id=tid).first()
            idx = entry.get('gallery_index', 0)
            if prod and old_url:
                gal = list(prod.imagens_galeria or [])
                if 0 <= idx < len(gal):
                    if execute:
                        gal[idx] = old_url
                        prod.imagens_galeria = gal
                    restored += 1
        elif ttype == 'logo':
            rest = db.query(Restaurante).filter_by(id=tenant).first()
            if rest and old_url:
                if execute:
                    rest.logo_url = old_url
                    rest.cardapio_logo_path = old_path
                restored += 1
        elif ttype == 'banner':
            rest = db.query(Restaurante).filter_by(id=tenant).first()
            if rest and old_url:
                if execute:
                    rest.banner_url = old_url
                    rest.cardapio_banner_path = old_path
                restored += 1
    if execute and restored:
        db.commit()
    else:
        db.rollback()
    return {'tenant': tenant, 'executed': execute, 'restored_references': restored}


def summarize_storage_observability(db, tenant: int | None = None) -> dict:
    """Low-cost storage and image reference observability without bucket scans.

    Distinguishes storage/reference state from network egress.
    """
    from sqlalchemy import func, inspect as sa_inspect
    from ..catalog_assistance import catalog_assistance_requests
    from ..models import Restaurante
    from .image_optimization import get_optimization_metrics
    from .storage_paths import extract_bucket_object_path

    has_assistance_table = sa_inspect(db.get_bind()).has_table('catalog_assistance_requests')
    rest_query = db.query(Restaurante)
    if tenant is not None:
        rest_query = rest_query.filter(Restaurante.id == tenant)
    restaurants = rest_query.order_by(Restaurante.id).all()

    tenants_report: list[dict] = []
    for rest in restaurants:
        tid = int(rest.id)
        prods = db.query(Produto).filter(Produto.restaurante_id == tid).all()
        unique_bucket_paths: set[str] = set()
        non_webp_bucket_paths: set[str] = set()
        embedded_data_uris = 0
        external_urls = 0
        gallery_refs_count = 0

        for p in prods:
            for idx, url in enumerate([p.imagem or '', *(p.imagens_galeria or [])]):
                if not url:
                    continue
                if idx > 0:
                    gallery_refs_count += 1
                b_path = extract_bucket_object_path(url)
                if b_path:
                    unique_bucket_paths.add(b_path)
                    if not b_path.lower().endswith('.webp'):
                        non_webp_bucket_paths.add(b_path)
                elif url.startswith('data:'):
                    embedded_data_uris += 1
                else:
                    external_urls += 1

        logo_path = extract_bucket_object_path(rest.logo_url or rest.cardapio_logo_path)
        banner_path = extract_bucket_object_path(rest.banner_url or rest.cardapio_banner_path)
        if logo_path:
            unique_bucket_paths.add(logo_path)
            if not logo_path.lower().endswith('.webp'):
                non_webp_bucket_paths.add(logo_path)
        if banner_path:
            unique_bucket_paths.add(banner_path)
            if not banner_path.lower().endswith('.webp'):
                non_webp_bucket_paths.add(banner_path)

        ret_rows = db.query(
            ProductImageRetirement.state,
            func.count(ProductImageRetirement.id),
        ).filter(
            ProductImageRetirement.restaurante_id == tid
        ).group_by(ProductImageRetirement.state).all()
        ret_counts = {state: int(cnt) for state, cnt in ret_rows}

        if has_assistance_table:
            assist_row = db.execute(
                select(
                    func.count(catalog_assistance_requests.c.id),
                    func.coalesce(func.sum(catalog_assistance_requests.c.file_size), 0),
                ).where(catalog_assistance_requests.c.restaurante_id == tid)
            ).one()
        else:
            assist_row = (0, 0)

        tenants_report.append({
            'restaurante_id': tid,
            'nome': rest.nome,
            'slug': rest.slug,
            'total_products': len(prods),
            'products_with_primary_image': sum(1 for p in prods if (p.imagem or '').strip()),
            'gallery_references_count': gallery_refs_count,
            'unique_bucket_objects_referenced': len(unique_bucket_paths),
            'non_webp_bucket_objects_referenced': len(non_webp_bucket_paths),
            'embedded_data_uris_count': embedded_data_uris,
            'external_urls_count': external_urls,
            'has_logo': bool(rest.logo_url or rest.cardapio_logo_path),
            'has_banner': bool(rest.banner_url or rest.cardapio_banner_path),
            'retirement_queue': {
                'pending': ret_counts.get('pending', 0),
                'deleting': ret_counts.get('deleting', 0),
                'deleted': ret_counts.get('deleted', 0),
            },
            'catalog_assistance_db_storage': {
                'files_count': int(assist_row[0] or 0),
                'stored_bytes': int(assist_row[1] or 0),
            },
        })

    return {
        'metric_type': 'storage_and_reference_state',
        'egress_note': (
            'Métricas de banco/bucket refletem armazenamento em repouso e referências; '
            'tráfego (egress) depende de hits HTTP no CDN/Supabase Storage e cache-control.'
        ),
        'runtime_upload_optimization_metrics': get_optimization_metrics(),
        'tenants': tenants_report,
    }


def run_tenant(tenant, *, mode='collect', execute=False, min_age_days=7):
    from ..database import engine, TenantSession, tenant_session_scope
    with engine.connect() as connection, TenantSession(bind=connection) as db:
        with tenant_session_scope(db, tenant):
            if mode == 'collect':
                return collect(db, tenant, execute=execute)
            if mode == 'observability':
                return summarize_storage_observability(db, tenant=tenant)
            if mode == 'migrate':
                with storage_client() as client:
                    return migrate_legacy_images(db, tenant, execute=execute, client=client)
            if mode == 'inventory':
                with storage_client() as client:
                    return inventory(db, tenant, min_age_days=min_age_days, client=client)
            with storage_client() as client:
                objects = list(list_product_objects(client, tenant))
            return reconcile(db, tenant, objects, min_age_days=min_age_days, execute=execute)

