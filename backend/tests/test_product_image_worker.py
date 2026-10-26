"""Disabled maintenance stays idle; enabled collection preserves tenant dispatch."""
import asyncio
from contextlib import nullcontext

import pytest

from app.services import product_image_worker as worker


@pytest.mark.parametrize('flag', [None, 'false', '', 'invalid'])
def test_disabled_collection_never_opens_database_across_hourly_cycles(monkeypatch, flag):
    from app import database
    if flag is None:
        monkeypatch.delenv('PRODUCT_IMAGE_GC_EXECUTE', raising=False)
    else:
        monkeypatch.setenv('PRODUCT_IMAGE_GC_EXECUTE', flag)

    def database_must_stay_idle():
        pytest.fail('Disabled image GC opened a database session')

    monkeypatch.setattr(database, 'SessionLocal', database_must_stay_idle)
    cycles = []

    async def advance_hour(seconds):
        assert seconds == 3600
        cycles.append(seconds)
        if len(cycles) == 4:
            raise asyncio.CancelledError

    monkeypatch.setattr(worker.asyncio, 'sleep', advance_hour)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(worker.run_worker())
    assert len(cycles) == 4


def test_enabled_collection_resumes_scoped_work_and_survives_one_tenant_failure(monkeypatch):
    from app import database
    from app.services.outbox import worker as outbox_worker
    from app.services import product_image_lifecycle

    monkeypatch.setenv('PRODUCT_IMAGE_GC_EXECUTE', 'true')
    monkeypatch.setattr(database, 'SessionLocal', lambda: nullcontext(object()))
    monkeypatch.setattr(outbox_worker, 'discover_active_restaurant_ids', lambda db: [101, 102])
    called = []

    def collect_tenant(tenant, *, execute):
        called.append((tenant, execute))
        if tenant == 101:
            raise RuntimeError('isolated storage failure')
        return []

    monkeypatch.setattr(product_image_lifecycle, 'run_tenant', collect_tenant)
    worker.sweep()
    assert called == [(101, True), (102, True)]
