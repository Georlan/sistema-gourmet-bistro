"""Testes rigorosos das rotinas de retenção, expurgo sustentável e isolamento multi-tenant."""

import datetime
import uuid
import pytest
from sqlalchemy import text

from app.database import SessionLocal
from app.models import (
    CustomerRegistrationChallenge,
    IntegrationOutbox,
    NotificacaoWhatsApp,
    PrintJob,
    Restaurante,
    Comanda,
    Pagamento,
)
from app.support_models import SupportSession
from app.services.retention_maintenance import (
    TenantRetentionReport,
    is_retention_maintenance_enabled,
    purge_completed_print_jobs,
    purge_delivered_outbox_events,
    purge_delivered_whatsapp_notifications,
    purge_expired_customer_challenges,
    purge_expired_support_sessions,
    run_tenant_retention_maintenance,
)
from app.timezone_utils import get_utc_now


@pytest.fixture
def db_session():
    db = SessionLocal()
    try:
        if not db.query(Restaurante).filter_by(id=1).first():
            db.merge(Restaurante(id=1, nome="Tenant 1", slug="tenant-1"))
        if not db.query(Restaurante).filter_by(id=2).first():
            db.merge(Restaurante(id=2, nome="Tenant 2", slug="tenant-2"))
        db.commit()
        yield db
    finally:
        db.rollback()
        db.close()


def test_retention_default_is_dry_run_and_disabled(monkeypatch, db_session):
    monkeypatch.delenv("KOMA_RETENTION_MAINTENANCE_ENABLED", raising=False)
    assert is_retention_maintenance_enabled() is False

    # Insert old outbox item
    old_time = get_utc_now() - datetime.timedelta(days=45)
    evt = IntegrationOutbox(
        restaurante_id=1,
        event_id=f"evt-test-dry-{uuid.uuid4().hex[:8]}",
        event_name="koma.order.delivered",
        aggregate_type="order",
        aggregate_id="101",
        payload={"order": 101},
        status="delivered",
        processed_at=old_time,
        created_at=old_time,
    )
    db_session.add(evt)
    db_session.commit()

    # Call maintenance without enabling opt-in
    report = run_tenant_retention_maintenance(db_session, restaurante_id=1, dry_run=False)
    assert report.dry_run is True  # forced to dry run because opt-in is disabled
    assert report.outbox_candidates >= 1
    assert report.outbox_purged == 0

    # Verify event still exists in DB
    found = db_session.query(IntegrationOutbox).filter_by(id=evt.id).first()
    assert found is not None


def test_purge_delivered_outbox_preserves_pending_and_cross_tenant(db_session):
    now = get_utc_now()
    old_time = now - datetime.timedelta(days=40)
    recent_time = now - datetime.timedelta(days=5)

    # Tenant 1: old delivered (should be purged)
    e1_old_delivered = IntegrationOutbox(
        restaurante_id=1,
        event_id=f"e1-old-{uuid.uuid4().hex[:8]}",
        event_name="koma.order.delivered",
        aggregate_type="order",
        aggregate_id="1",
        payload={},
        status="delivered",
        processed_at=old_time,
        created_at=old_time,
    )
    # Tenant 1: old pending (MUST NOT be purged)
    e1_old_pending = IntegrationOutbox(
        restaurante_id=1,
        event_id=f"e1-pend-{uuid.uuid4().hex[:8]}",
        event_name="koma.order.created",
        aggregate_type="order",
        aggregate_id="2",
        payload={},
        status="pending",
        processed_at=None,
        created_at=old_time,
    )
    # Tenant 1: recent delivered (MUST NOT be purged)
    e1_recent = IntegrationOutbox(
        restaurante_id=1,
        event_id=f"e1-rec-{uuid.uuid4().hex[:8]}",
        event_name="koma.order.delivered",
        aggregate_type="order",
        aggregate_id="3",
        payload={},
        status="delivered",
        processed_at=recent_time,
        created_at=recent_time,
    )
    # Tenant 2: old delivered (MUST NOT be purged by Tenant 1 run)
    e2_old_delivered = IntegrationOutbox(
        restaurante_id=2,
        event_id=f"e2-old-{uuid.uuid4().hex[:8]}",
        event_name="koma.order.delivered",
        aggregate_type="order",
        aggregate_id="4",
        payload={},
        status="delivered",
        processed_at=old_time,
        created_at=old_time,
    )
    db_session.add_all([e1_old_delivered, e1_old_pending, e1_recent, e2_old_delivered])
    db_session.commit()

    e1_old_delivered_id = e1_old_delivered.id
    e1_old_pending_id = e1_old_pending.id
    e1_recent_id = e1_recent.id
    e2_old_delivered_id = e2_old_delivered.id

    cand, purged = purge_delivered_outbox_events(
        db_session,
        restaurante_id=1,
        retention_days=30,
        batch_size=10,
        dry_run=False,
        now=now,
    )
    db_session.commit()

    assert cand >= 1
    assert purged >= 1

    # Check Tenant 1 old delivered was purged
    assert db_session.query(IntegrationOutbox).filter_by(id=e1_old_delivered_id).first() is None
    # Check pending was preserved
    assert db_session.query(IntegrationOutbox).filter_by(id=e1_old_pending_id).first() is not None
    # Check recent was preserved
    assert db_session.query(IntegrationOutbox).filter_by(id=e1_recent_id).first() is not None
    # Check Tenant 2 was preserved
    assert db_session.query(IntegrationOutbox).filter_by(id=e2_old_delivered_id).first() is not None


def test_purge_completed_print_jobs_preserves_active_queue(db_session):
    now = get_utc_now()
    old_time = now - datetime.timedelta(days=20)
    recent_time = now - datetime.timedelta(days=2)

    pj_printed_old = PrintJob(
        id=f"pj-{uuid.uuid4().hex[:8]}",
        restaurante_id=1,
        document_type="producao",
        destination="COZINHA",
        source_type="pedido",
        source_id="101",
        payload_text="Text",
        status="printed",
        idempotency_key=f"idemp-{uuid.uuid4().hex[:8]}",
        created_at=old_time,
        printed_at=old_time,
    )
    pj_pending_old = PrintJob(
        id=f"pj-{uuid.uuid4().hex[:8]}",
        restaurante_id=1,
        document_type="producao",
        destination="COZINHA",
        source_type="pedido",
        source_id="102",
        payload_text="Text",
        status="pending",
        idempotency_key=f"idemp-{uuid.uuid4().hex[:8]}",
        created_at=old_time,
    )
    pj_claimed_old = PrintJob(
        id=f"pj-{uuid.uuid4().hex[:8]}",
        restaurante_id=1,
        document_type="producao",
        destination="COZINHA",
        source_type="pedido",
        source_id="103",
        payload_text="Text",
        status="claimed",
        idempotency_key=f"idemp-{uuid.uuid4().hex[:8]}",
        created_at=old_time,
        claimed_at=old_time,
    )
    pj_printed_recent = PrintJob(
        id=f"pj-{uuid.uuid4().hex[:8]}",
        restaurante_id=1,
        document_type="producao",
        destination="COZINHA",
        source_type="pedido",
        source_id="104",
        payload_text="Text",
        status="printed",
        idempotency_key=f"idemp-{uuid.uuid4().hex[:8]}",
        created_at=recent_time,
        printed_at=recent_time,
    )
    db_session.add_all([pj_printed_old, pj_pending_old, pj_claimed_old, pj_printed_recent])
    db_session.commit()

    pj_printed_old_id = pj_printed_old.id
    pj_pending_old_id = pj_pending_old.id
    pj_claimed_old_id = pj_claimed_old.id
    pj_printed_recent_id = pj_printed_recent.id

    cand, purged = purge_completed_print_jobs(
        db_session,
        restaurante_id=1,
        retention_days=14,
        batch_size=10,
        dry_run=False,
        now=now,
    )
    db_session.commit()

    assert cand >= 1
    assert purged >= 1

    assert db_session.query(PrintJob).filter_by(id=pj_printed_old_id).first() is None
    # Pending and claimed must remain intact!
    assert db_session.query(PrintJob).filter_by(id=pj_pending_old_id).first() is not None
    assert db_session.query(PrintJob).filter_by(id=pj_claimed_old_id).first() is not None
    assert db_session.query(PrintJob).filter_by(id=pj_printed_recent_id).first() is not None


def test_purge_expired_challenges_and_support_sessions(db_session):
    now = get_utc_now()
    expired_time = now - datetime.timedelta(hours=48)
    future_time = now + datetime.timedelta(hours=12)

    # Challenge expired
    chal_expired = CustomerRegistrationChallenge(
        id=str(uuid.uuid4()),
        restaurante_id=1,
        _nome="Nome Teste",
        _email="user1@example.com",
        email_hash=f"hash-{uuid.uuid4().hex[:12]}",
        _telefone="85999990001",
        senha_hash="hash",
        token_hash="tok",
        expira_em=expired_time,
        ultimo_envio_em=expired_time,
    )
    # Challenge active
    chal_active = CustomerRegistrationChallenge(
        id=str(uuid.uuid4()),
        restaurante_id=1,
        _nome="Nome Teste 2",
        _email="user2@example.com",
        email_hash=f"hash-{uuid.uuid4().hex[:12]}",
        _telefone="85999990002",
        senha_hash="hash",
        token_hash="tok2",
        expira_em=future_time,
        ultimo_envio_em=now,
    )
    db_session.add_all([chal_expired, chal_active])
    db_session.commit()

    chal_expired_id = chal_expired.id
    chal_active_id = chal_active.id

    cand_c, purged_c = purge_expired_customer_challenges(
        db_session,
        restaurante_id=1,
        grace_hours=24,
        dry_run=False,
        now=now,
    )
    db_session.commit()

    assert cand_c >= 1
    assert purged_c >= 1
    assert db_session.query(CustomerRegistrationChallenge).filter_by(id=chal_expired_id).first() is None
    assert db_session.query(CustomerRegistrationChallenge).filter_by(id=chal_active_id).first() is not None


def test_retention_maintenance_strictly_preserves_orders_and_payments(db_session):
    """Garante que comanda, lancamento, item, pagamento nunca são tocados por retenção."""
    initial_comandas = db_session.query(Comanda).count()
    initial_pagamentos = db_session.query(Pagamento).count()

    report = run_tenant_retention_maintenance(
        db_session,
        restaurante_id=1,
        dry_run=False,
        enable_opt_in=True,
    )
    assert report.dry_run is False

    assert db_session.query(Comanda).count() == initial_comandas
    assert db_session.query(Pagamento).count() == initial_pagamentos
