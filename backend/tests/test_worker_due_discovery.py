import datetime
import time

import pytest
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import Session

from app.services.outbox.worker import OutboxWorker, discover_due_restaurant_ids


@pytest.fixture
def discovery_db():
    engine = create_engine('sqlite://')
    with engine.begin() as db:
        db.execute(text('CREATE TABLE restaurantes (id INTEGER PRIMARY KEY)'))
        db.execute(text('CREATE TABLE integration_outbox (restaurante_id INTEGER, status TEXT, next_retry_at TIMESTAMP, locked_at TIMESTAMP)'))
        db.execute(text('CREATE TABLE scheduled_orders (restaurante_id INTEGER, scheduled_for TIMESTAMP, released_at TIMESTAMP)'))
    with Session(engine) as db:
        yield db
    engine.dispose()


def test_discovery_includes_due_retries_stale_claims_and_schedules_only(discovery_db):
    db = discovery_db
    now = datetime.datetime.now(datetime.timezone.utc)
    past, future = now - datetime.timedelta(hours=1), now + datetime.timedelta(hours=1)
    for rid, status, retry, locked in [
        (1, 'pending', None, None), (1, 'failed', past, None),
        (2, 'failed', future, None), (3, 'processing', None, past),
        (4, 'processing', None, future), (5, 'delivered', None, None),
        (6, 'dead_letter', None, None), (7, 'processing', None, None),
    ]:
        db.execute(text('INSERT INTO integration_outbox VALUES (:rid,:status,:retry,:locked)'),
                   dict(rid=rid, status=status, retry=retry, locked=locked))
    for rid, scheduled, released in [(8, past, None), (9, future, None), (10, past, past)]:
        db.execute(text('INSERT INTO scheduled_orders VALUES (:rid,:scheduled,:released)'),
                   dict(rid=rid, scheduled=scheduled, released=released))
    db.commit()
    assert discover_due_restaurant_ids(db, stale_timeout_seconds=120) == [1, 3, 7, 8]


@pytest.mark.parametrize('tenants', [1, 5, 10, 20, 100, 1000])
def test_idle_scan_query_count_does_not_grow_with_tenants(discovery_db, monkeypatch, tenants):
    db = discovery_db
    for rid in range(1, tenants + 1):
        db.execute(text('INSERT INTO restaurantes VALUES (:rid)'), dict(rid=rid))
    db.commit()
    statements = []
    event.listen(db.get_bind(), 'before_cursor_execute',
                 lambda conn, cursor, statement, params, context, many: statements.append(statement))
    monkeypatch.setattr('app.services.outbox.worker.SessionLocal', lambda: db)
    worker = OutboxWorker()
    # Maintenance is independent of the idle dispatch cycle.
    worker._last_chat_retention_at = time.monotonic()
    assert worker.run_once()['total'] == 0
    assert len(statements) == 1
    assert 'UNION' in statements[0]


def test_discovery_database_errors_propagate(discovery_db):
    discovery_db.execute(text('DROP TABLE integration_outbox'))
    with pytest.raises(Exception):
        discover_due_restaurant_ids(discovery_db, stale_timeout_seconds=120)


@pytest.mark.parametrize("failed_tenant", [None, 2])
def test_retention_deadline_survives_idle_cycles_and_retries(discovery_db, monkeypatch, failed_tenant):
    from contextlib import nullcontext

    db = discovery_db
    for rid in (1, 2):
        db.execute(text('INSERT INTO restaurantes VALUES (:rid)'), dict(rid=rid))
    db.commit()
    clock = [100.0]
    monkeypatch.setattr('app.services.outbox.worker.time.monotonic', lambda: clock[0])
    monkeypatch.setattr('app.services.outbox.worker.SessionLocal', lambda: db)
    monkeypatch.setattr('app.services.outbox.worker.tenant_session_scope', lambda db, rid: nullcontext())
    monkeypatch.setattr('app.services.outbox.worker.release_due_scheduled_orders_in_session', lambda *a, **kw: 0)
    monkeypatch.setattr('app.services.outbox.worker.dispatch_pending_outbox_events', lambda *a, **kw: {})
    visited = []
    failing = [failed_tenant]

    def purge(db, *, restaurante_id, **kwargs):
        visited.append(restaurante_id)
        if restaurante_id == failing[0]:
            raise RuntimeError('simulated maintenance failure')
        return 0

    monkeypatch.setattr('app.services.outbox.worker.purge_expired_order_chat_content', purge)
    worker = OutboxWorker()
    worker._last_chat_retention_at = 100.0
    for elapsed in (30, 60, 3600, 21599):
        clock[0] = 100.0 + elapsed
        worker.run_once()
        assert worker._last_chat_retention_at == 100.0
        assert visited == []
    clock[0] = 21700.0
    worker.run_once()
    assert visited == [1, 2]
    if failed_tenant:
        assert worker._last_chat_retention_at == 100.0
        failing[0] = None
        visited.clear()
        worker.run_once()
        assert visited == [1, 2]
    assert worker._last_chat_retention_at == 21700.0
    visited.clear()
    clock[0] += 30
    worker.run_once()
    assert visited == []


def test_targeted_dispatch_does_not_postpone_other_tenants_maintenance(discovery_db, monkeypatch):
    from contextlib import nullcontext

    monkeypatch.setattr('app.services.outbox.worker.SessionLocal', lambda: discovery_db)
    monkeypatch.setattr('app.services.outbox.worker.time.monotonic', lambda: 30000.0)
    monkeypatch.setattr('app.services.outbox.worker.tenant_session_scope', lambda db, rid: nullcontext())
    monkeypatch.setattr('app.services.outbox.worker.release_due_scheduled_orders_in_session', lambda *a, **kw: 0)
    monkeypatch.setattr('app.services.outbox.worker.dispatch_pending_outbox_events', lambda *a, **kw: {})
    monkeypatch.setattr('app.services.outbox.worker.purge_expired_order_chat_content', lambda *a, **kw: 0)
    worker = OutboxWorker()
    worker._last_chat_retention_at = 100.0
    worker.run_once(restaurant_id=1)
    assert worker._last_chat_retention_at == 100.0
