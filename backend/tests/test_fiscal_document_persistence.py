from __future__ import annotations

import uuid
from decimal import Decimal

import pytest

from app.database import Base, SessionLocal, current_restaurante_id, engine
from app.fiscal_models import FiscalDocument, FiscalEvent, FiscalSequence
from app.models import Restaurante
from app.services.fiscal_documents import (
    FiscalEventConflict,
    create_numbered_fiscal_document,
    transition_fiscal_document,
)


@pytest.fixture
def fiscal_session():
    Base.metadata.create_all(bind=engine)
    tenant_id = 930000 + (uuid.uuid4().int % 50000)
    token = current_restaurante_id.set(tenant_id)
    db = SessionLocal(restaurante_id=tenant_id)
    db.add(Restaurante(id=tenant_id, nome="Fiscal Persistence", plano="pocket"))
    db.commit()

    try:
        yield db, tenant_id
    finally:
        db.rollback()
        db.query(FiscalEvent).filter(FiscalEvent.restaurante_id == tenant_id).delete()
        db.query(FiscalDocument).filter(FiscalDocument.restaurante_id == tenant_id).delete()
        db.query(FiscalSequence).filter(FiscalSequence.restaurante_id == tenant_id).delete()
        db.query(Restaurante).filter(Restaurante.id == tenant_id).delete()
        db.commit()
        db.close()
        current_restaurante_id.reset(token)


def _create(db, tenant_id: int, key: str, *, environment: str = "homologacao", series: int = 1):
    return create_numbered_fiscal_document(
        db,
        restaurante_id=tenant_id,
        idempotency_key=key,
        sale_snapshot={"sale_id": key, "items": [{"sku": "cafe", "qty": 1}]},
        total_amount=Decimal("12.50"),
        environment=environment,
        series=series,
    )


def test_document_creation_replays_same_idempotency_key_without_burning_number(fiscal_session):
    db, tenant_id = fiscal_session

    first = _create(db, tenant_id, "sale-1")
    replay = _create(db, tenant_id, "sale-1")

    assert first.replayed is False
    assert replay.replayed is True
    assert replay.document.id == first.document.id
    assert replay.document.number == 1

    sequence = db.query(FiscalSequence).filter(
        FiscalSequence.restaurante_id == tenant_id,
        FiscalSequence.environment == "homologacao",
        FiscalSequence.model == "65",
        FiscalSequence.series == 1,
    ).one()
    assert sequence.next_number == 2
    assert db.query(FiscalEvent).filter(
        FiscalEvent.restaurante_id == tenant_id,
        FiscalEvent.document_id == first.document.id,
        FiscalEvent.event_key == "document.created",
    ).count() == 1


def test_sequence_is_monotonic_and_independent_by_environment_and_series(fiscal_session):
    db, tenant_id = fiscal_session

    assert _create(db, tenant_id, "sale-1").document.number == 1
    assert _create(db, tenant_id, "sale-2").document.number == 2
    assert _create(db, tenant_id, "sale-prod", environment="producao").document.number == 1
    assert _create(db, tenant_id, "sale-series-2", series=2).document.number == 1


def test_transition_and_event_are_committed_once_and_replay_safely(fiscal_session):
    db, tenant_id = fiscal_session
    created = _create(db, tenant_id, "sale-transition").document

    first = transition_fiscal_document(
        db,
        restaurante_id=tenant_id,
        document_id=created.id,
        event_key="preflight:ready",
        event_type="preflight.passed",
        to_status="ready",
        payload={"rule_set": "test-v1"},
    )
    replay = transition_fiscal_document(
        db,
        restaurante_id=tenant_id,
        document_id=created.id,
        event_key="preflight:ready",
        event_type="preflight.passed",
        to_status="ready",
        payload={"rule_set": "ignored-on-replay"},
    )

    assert first.replayed is False
    assert replay.replayed is True
    assert replay.document.status == "ready"
    assert replay.event.id == first.event.id
    assert db.query(FiscalEvent).filter(
        FiscalEvent.restaurante_id == tenant_id,
        FiscalEvent.document_id == created.id,
        FiscalEvent.event_key == "preflight:ready",
    ).count() == 1


def test_event_key_cannot_be_reused_for_different_transition(fiscal_session):
    db, tenant_id = fiscal_session
    created = _create(db, tenant_id, "sale-conflict").document
    transition_fiscal_document(
        db,
        restaurante_id=tenant_id,
        document_id=created.id,
        event_key="preflight:ready",
        event_type="preflight.passed",
        to_status="ready",
    )

    with pytest.raises(FiscalEventConflict, match="event_key"):
        transition_fiscal_document(
            db,
            restaurante_id=tenant_id,
            document_id=created.id,
            event_key="preflight:ready",
            event_type="submission.started",
            to_status="submitting",
        )

    db.expire_all()
    assert db.query(FiscalDocument).filter(
        FiscalDocument.restaurante_id == tenant_id,
        FiscalDocument.id == created.id,
    ).one().status == "ready"
