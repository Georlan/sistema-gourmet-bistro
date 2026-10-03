import datetime
import os
import time

import pytest
from sqlalchemy import text

from app.database import SessionLocal
from app.models import IntegrationOutbox, Restaurante
from app.services.outbox.worker import OutboxWorker, discover_due_restaurant_ids

pytestmark = pytest.mark.skipif(
    os.getenv('KOMA_PYTEST_USE_EXTERNAL_DATABASE', 'false').lower() != 'true',
    reason='Requires migrated ephemeral local PostgreSQL with a restricted runtime role',
)


@pytest.fixture(scope="module")
def seeded_work():
    now = datetime.datetime.now(datetime.timezone.utc)
    for rid, status, retry, locked in [
        (99201, 'pending', None, None),
        (99202, 'failed', now + datetime.timedelta(hours=1), None),
        (99203, 'processing', None, now - datetime.timedelta(hours=1)),
    ]:
        with SessionLocal(restaurante_id=rid) as db:
            db.add(Restaurante(id=rid, nome=f'Worker test {rid}', plano='pocket'))
            db.flush()
            db.add(IntegrationOutbox(
                id=f'worker-test-{rid}', restaurante_id=rid,
                event_id=f'worker-test-{rid}', event_name='koma.order.created',
                aggregate_type='order', aggregate_id=f'order-{rid}', payload={},
                status=status, next_retry_at=retry, locked_at=locked,
            ))
            db.commit()


def test_due_discovery_is_global_but_processing_remains_tenant_scoped(seeded_work):
    with SessionLocal() as db:
        role = db.execute(text('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = session_user')).one()
        assert not role.rolsuper and not role.rolbypassrls
        ids = discover_due_restaurant_ids(db, stale_timeout_seconds=120)
        assert 99201 in ids and 99203 in ids and 99202 not in ids
        # The intentionally global discovery exposes IDs only. Raw payload reads
        # still obey the database's RLS, beyond ORM filtering.
        assert db.execute(text('SELECT id FROM integration_outbox')).all() == []
        public_grants = db.execute(text("""
            SELECT count(*) FROM pg_proc p, LATERAL aclexplode(p.proacl) a
            WHERE p.oid = 'koma_internal.worker_due_restaurants(timestamptz,timestamptz)'::regprocedure
              AND a.grantee = 0
        """)).scalar_one()
        assert public_grants == 0
    with SessionLocal(restaurante_id=99201) as db:
        assert [r[0] for r in db.execute(text('SELECT id FROM integration_outbox')).all()] == ['worker-test-99201']


def test_postgres_idle_worker_does_not_visit_tenant_payloads(monkeypatch, seeded_work):
    visited = []
    monkeypatch.setattr('app.services.outbox.worker.dispatch_pending_outbox_events',
                        lambda db, **kw: visited.append(kw['restaurant_id']) or {})
    monkeypatch.setattr('app.services.outbox.worker.release_due_scheduled_orders_in_session',
                        lambda db, **kw: 0)
    worker = OutboxWorker()
    worker._last_chat_retention_at = time.monotonic()
    worker.run_once()
    assert 99201 in visited and 99203 in visited and 99202 not in visited
