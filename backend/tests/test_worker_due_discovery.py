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
@pytest.mark.parametrize('elapsed', [0, 21600, 43200])
def test_idle_scan_query_count_does_not_grow_with_tenants(discovery_db, monkeypatch, tenants, elapsed):
    db = discovery_db
    for rid in range(1, tenants + 1):
        db.execute(text('INSERT INTO restaurantes VALUES (:rid)'), dict(rid=rid))
    db.commit()
    statements = []
    event.listen(db.get_bind(), 'before_cursor_execute',
                 lambda conn, cursor, statement, params, context, many: statements.append(statement))
    monkeypatch.setattr('app.services.outbox.worker.SessionLocal', lambda: db)
    monkeypatch.delenv('ORDER_CHAT_RETENTION_ENABLED', raising=False)
    monkeypatch.setattr('app.services.outbox.worker.time.monotonic', lambda: 100000.0 + elapsed)
    def unexpected_cleanup(*args, **kwargs):
        pytest.fail('Default dispatch must not invoke destructive retention')
    monkeypatch.setattr('app.services.outbox.worker.purge_expired_order_chat_content', unexpected_cleanup)
    worker = OutboxWorker()
    # Even startup and multiple retention windows remain one read-only query.
    assert worker.run_once()['total'] == 0
    assert len(statements) == 1
    assert 'UNION' in statements[0]


def test_discovery_database_errors_propagate(discovery_db):
    discovery_db.execute(text('DROP TABLE integration_outbox'))
    with pytest.raises(Exception):
        discover_due_restaurant_ids(discovery_db, stale_timeout_seconds=120)


@pytest.mark.parametrize('retention_enabled', [None, 'false', '1', 'invalid'])
@pytest.mark.parametrize('targeted', [False, True])
def test_default_dispatch_preserves_due_work_without_cleanup(discovery_db, monkeypatch, retention_enabled, targeted):
    from contextlib import nullcontext

    db = discovery_db
    db.execute(text("INSERT INTO restaurantes VALUES (1), (2)"))
    db.execute(text("INSERT INTO integration_outbox VALUES (1, 'pending', NULL, NULL)"))
    db.commit()
    if retention_enabled is None:
        monkeypatch.delenv('ORDER_CHAT_RETENTION_ENABLED', raising=False)
    else:
        monkeypatch.setenv('ORDER_CHAT_RETENTION_ENABLED', retention_enabled)
    monkeypatch.setattr('app.services.outbox.worker.SessionLocal', lambda: db)
    monkeypatch.setattr('app.services.outbox.worker.time.monotonic', lambda: 100000.0)
    monkeypatch.setattr('app.services.outbox.worker.tenant_session_scope', lambda db, rid: nullcontext())
    released, dispatched, purged = [], [], []
    monkeypatch.setattr('app.services.outbox.worker.release_due_scheduled_orders_in_session',
                        lambda db, **kw: released.append(kw['restaurante_id']) or 1)
    monkeypatch.setattr('app.services.outbox.worker.dispatch_pending_outbox_events',
                        lambda db, **kw: dispatched.append(kw['restaurant_id']) or {'total': 1, 'delivered': 1})
    monkeypatch.setattr('app.services.outbox.worker.purge_expired_order_chat_content',
                        lambda db, **kw: purged.append(kw['restaurante_id']) or 0)
    stats = OutboxWorker().run_once(restaurant_id=1 if targeted else None)
    assert released == dispatched == [1]
    assert purged == []
    assert stats['scheduled_released'] == stats['delivered'] == 1
    assert stats['chat_conversations_purged'] == 0


@pytest.mark.parametrize("failed_tenant", [None, 2])
def test_retention_deadline_survives_idle_cycles_and_retries(discovery_db, monkeypatch, failed_tenant):
    from contextlib import nullcontext

    db = discovery_db
    monkeypatch.setenv('ORDER_CHAT_RETENTION_ENABLED', 'true')
    for rid in (1, 2):
        db.execute(text('INSERT INTO restaurantes VALUES (:rid)'), dict(rid=rid))
    db.commit()
    clock = [100.0]
    monkeypatch.setattr('app.services.outbox.worker.time.monotonic', lambda: clock[0])
    monkeypatch.setattr('app.services.outbox.worker.SessionLocal', lambda: db)
    monkeypatch.setattr('app.services.outbox.worker.tenant_session_scope', lambda db, rid: nullcontext())
    monkeypatch.setattr('app.services.outbox.worker.release_due_scheduled_orders_in_session', lambda *a, **kw: 0)
    visited = []
    dispatched = []
    def dispatch(db, *, restaurant_id, **kwargs):
        if restaurant_id == failing[0]:
            assert not db.in_transaction()
        dispatched.append(restaurant_id)
        return {"total": 1, "delivered": 1}
    monkeypatch.setattr('app.services.outbox.worker.dispatch_pending_outbox_events', dispatch)
    failing = [failed_tenant]

    def purge(db, *, restaurante_id, **kwargs):
        visited.append(restaurante_id)
        if restaurante_id == failing[0]:
            db.execute(text('INSERT INTO restaurantes VALUES (99)'))
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
    stats = worker.run_once()
    assert visited == [1, 2]
    assert dispatched == [1, 2]
    assert stats['delivered'] == 2
    assert db.execute(text('SELECT count(*) FROM restaurantes WHERE id = 99')).scalar() == 0
    db.rollback()
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

    monkeypatch.setenv('ORDER_CHAT_RETENTION_ENABLED', 'true')

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
