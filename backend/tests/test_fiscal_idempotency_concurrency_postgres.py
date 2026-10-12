"""Fiscal races against real PostgreSQL, in self-cleaning disposable schemas.

No operational fixture, tenant 6, live credentials or fiscal provider is used.
Only the explicitly configured loopback ``koma_fiscal_test`` database is allowed.
"""
from __future__ import annotations

import copy
import os
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest
from sqlalchemy import Column, ForeignKey, Integer, MetaData, String, Table
from sqlalchemy import UniqueConstraint, create_engine, event, insert, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from app.fiscal_models import (
    FiscalDocument, FiscalEvent, FiscalSequence, RestaurantFiscalProfile,
)
from app.services import fiscal_documents, fiscal_issuance
from app.services.fiscal_documents import FiscalEventConflict, FiscalIdempotencyConflict
from app.services.fiscal_state import InvalidFiscalTransition


TENANT = 880091
COMANDA = "fiscal-concurrency-synthetic-sale"
WAIT_SECONDS = 10


def _metadata():
    # Copy actual fiscal definitions without invoking Base.metadata listeners or
    # creating the application's operational schema/default-restaurant seed.
    metadata = MetaData()
    Table("restaurantes", metadata, Column("id", Integer, primary_key=True))
    Table(
        "comandas", metadata,
        Column("id", String, primary_key=True),
        Column("restaurante_id", Integer, ForeignKey("restaurantes.id"), nullable=False),
        UniqueConstraint("restaurante_id", "id", name="uq_comandas_restaurante_id_id"),
    )
    for model in (RestaurantFiscalProfile, FiscalDocument, FiscalEvent, FiscalSequence):
        model.__table__.to_metadata(metadata)
    return metadata


@pytest.fixture
def postgres_fiscal():
    raw_url = os.getenv("KOMA_FISCAL_TENANT_TEST_POSTGRES_URL", "").strip()
    if not raw_url:
        pytest.skip("Requires the disposable local fiscal PostgreSQL service")
    url = make_url(raw_url)
    if (
        url.get_backend_name() != "postgresql"
        or url.host not in {"localhost", "127.0.0.1", "::1"}
        or url.database != "koma_fiscal_test"
    ):
        pytest.fail("Fiscal concurrency tests accept only local ephemeral koma_fiscal_test.")

    schema = "fiscal_race_" + uuid.uuid4().hex
    admin = create_engine(url, connect_args={"connect_timeout": WAIT_SECONDS})
    engine = create_engine(
        url,
        connect_args={"connect_timeout": WAIT_SECONDS},
        execution_options={"schema_translate_map": {None: schema}},
    )

    @event.listens_for(engine, "connect")
    def local_session(connection, _record):
        with connection.cursor() as cursor:
            cursor.execute(f'SET search_path TO "{schema}"')
            cursor.execute("SET statement_timeout TO '10000ms'")
            cursor.execute("SET lock_timeout TO '10000ms'")
        connection.commit()

    metadata = _metadata()
    sessions = sessionmaker(bind=engine, autoflush=False)
    try:
        with admin.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        metadata.create_all(engine)
        with engine.begin() as connection:
            connection.execute(insert(metadata.tables["restaurantes"]), {"id": TENANT})
            connection.execute(insert(metadata.tables["comandas"]), {
                "id": COMANDA, "restaurante_id": TENANT,
            })
        yield SimpleNamespace(engine=engine, sessions=sessions)
    finally:
        engine.dispose()
        with admin.begin() as connection:
            connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        admin.dispose()


def _request(**changes):
    request = {
        "restaurante_id": TENANT,
        "idempotency_key": "concurrent-sale",
        "comanda_id": COMANDA,
        "sale_snapshot": {
            "saleId": COMANDA,
            "items": [{"name": "Synthetic café", "amount": "12.50"}],
        },
        "total_amount": "12.50",
        "environment": "homologacao",
        "model": "65",
        "series": 1,
        "provider": "direct_sefaz",
    }
    request.update(changes)
    return request


def _create(sessions, request):
    with sessions() as db:
        try:
            result = fiscal_documents.create_numbered_fiscal_document(db, **request)
            return SimpleNamespace(
                conflict=None, replayed=result.replayed,
                document_id=result.document.id, number=result.document.number,
            )
        except FiscalIdempotencyConflict as exc:
            # The unique-violation recovery must already have rolled back and
            # restored a usable transaction before comparing the winning row.
            assert db.is_active
            return SimpleNamespace(conflict=type(exc), replayed=None)


def _race_create(postgres_fiscal, monkeypatch, requests):
    barrier = threading.Barrier(2)
    reserve = fiscal_documents.reserve_fiscal_number

    def reserve_after_both_initial_reads(*args, **kwargs):
        # Both requests have observed an absent idempotency key before either
        # reaches PostgreSQL's actual sequence UPSERT/unique-constraint race.
        barrier.wait(WAIT_SECONDS)
        return reserve(*args, **kwargs)

    monkeypatch.setattr(fiscal_documents, "reserve_fiscal_number", reserve_after_both_initial_reads)
    with ThreadPoolExecutor(max_workers=2, thread_name_prefix="fiscal-create") as workers:
        futures = [workers.submit(_create, postgres_fiscal.sessions, request) for request in requests]
        results = [future.result(timeout=WAIT_SECONDS * 2) for future in futures]
    monkeypatch.setattr(fiscal_documents, "reserve_fiscal_number", reserve)
    return results


def test_equal_concurrent_creation_replays_one_document_and_one_number(postgres_fiscal, monkeypatch):
    first = _request()
    # Canonical comparison must survive both JSON storage and property ordering.
    second = _request(sale_snapshot={
        "items": [{"amount": "12.50", "name": "Synthetic café"}], "saleId": COMANDA,
    }, total_amount="12.500")
    results = _race_create(postgres_fiscal, monkeypatch, [first, second])

    assert all(result.conflict is None for result in results)
    assert sorted(result.replayed for result in results) == [False, True]
    assert len({result.document_id for result in results}) == 1
    assert {result.number for result in results} == {1}
    with postgres_fiscal.sessions() as db:
        assert db.query(FiscalDocument).count() == 1
        assert db.query(FiscalEvent).count() == 1
        sequence = db.query(FiscalSequence).one()
        assert sequence.next_number == 2
        assert sequence.version == 1


def test_different_concurrent_content_conflicts_without_burning_number(postgres_fiscal, monkeypatch):
    original = _request()
    changed_snapshot = copy.deepcopy(original["sale_snapshot"])
    changed_snapshot["items"][0]["name"] = "Different synthetic product"
    changed = _request(sale_snapshot=changed_snapshot)
    results = _race_create(postgres_fiscal, monkeypatch, [original, changed])

    assert sum(result.conflict is FiscalIdempotencyConflict for result in results) == 1
    assert sum(result.conflict is None and result.replayed is False for result in results) == 1
    with postgres_fiscal.sessions() as db:
        assert db.query(FiscalDocument).count() == 1
        assert db.query(FiscalEvent).count() == 1
        sequence = db.query(FiscalSequence).one()
        assert (sequence.next_number, sequence.version) == (2, 1)
        next_document = fiscal_documents.create_numbered_fiscal_document(
            db, **_request(idempotency_key="next-independent-sale"),
        )
        assert next_document.document.number == 2
        assert db.query(FiscalSequence).one().next_number == 3


@pytest.mark.parametrize("different_payload", [False, True])
def test_concurrent_event_rechecks_key_after_waiting_for_document_lock(postgres_fiscal, different_payload):
    with postgres_fiscal.sessions() as db:
        document_id = fiscal_documents.create_numbered_fiscal_document(db, **_request()).document.id
    barrier = threading.Barrier(2)
    per_thread = threading.local()

    def synchronize_initial_event_read(_connection, _cursor, statement, _parameters, _context, _many):
        if (
            statement.lstrip().upper().startswith("SELECT")
            and "fiscal_events" in statement
            and not getattr(per_thread, "initial_event_read", False)
        ):
            per_thread.initial_event_read = True
            barrier.wait(WAIT_SECONDS)

    request = {
        "restaurante_id": TENANT, "document_id": document_id,
        "event_key": "same-ready-event", "event_type": "preflight.passed",
        "to_status": "ready", "external_protocol": "synthetic-protocol",
        "payload": {"rule": "v1"},
    }
    changed = copy.deepcopy(request)
    if different_payload:
        changed["payload"]["rule"] = "v2"

    def transition(values):
        with postgres_fiscal.sessions() as db:
            try:
                result = fiscal_documents.transition_fiscal_document(db, **values)
                return SimpleNamespace(conflict=None, replayed=result.replayed, event_id=result.event.id)
            except FiscalEventConflict as exc:
                return SimpleNamespace(conflict=type(exc), replayed=None)

    event.listen(postgres_fiscal.engine, "after_cursor_execute", synchronize_initial_event_read)
    try:
        with ThreadPoolExecutor(max_workers=2, thread_name_prefix="fiscal-event") as workers:
            futures = [workers.submit(transition, values) for values in (request, changed)]
            results = [future.result(timeout=WAIT_SECONDS * 2) for future in futures]
    finally:
        event.remove(postgres_fiscal.engine, "after_cursor_execute", synchronize_initial_event_read)

    if different_payload:
        assert sum(result.conflict is FiscalEventConflict for result in results) == 1
        assert sum(result.conflict is None and result.replayed is False for result in results) == 1
    else:
        assert all(result.conflict is None for result in results)
        assert sorted(result.replayed for result in results) == [False, True]
        assert len({result.event_id for result in results}) == 1
    with postgres_fiscal.sessions() as db:
        document = db.query(FiscalDocument).one()
        assert document.status == "ready"
        assert db.query(FiscalEvent).count() == 2
        ready_event = db.query(FiscalEvent).filter(FiscalEvent.event_key == request["event_key"]).one()
        assert ready_event.from_status == "draft"
        assert ready_event.to_status == "ready"
        assert ready_event.payload in (request["payload"], changed["payload"])
        assert db.query(FiscalSequence).one().next_number == 2


def test_locked_transition_refreshes_preloaded_document_before_validating(postgres_fiscal):
    with postgres_fiscal.sessions() as db:
        document_id = fiscal_documents.create_numbered_fiscal_document(db, **_request()).document.id

    with postgres_fiscal.sessions() as stale, postgres_fiscal.sessions() as current:
        cached = stale.query(FiscalDocument).filter(FiscalDocument.id == document_id).one()
        assert cached.status == "draft"
        for target in ("ready", "submitting"):
            fiscal_documents.transition_fiscal_document(
                current, restaurante_id=TENANT, document_id=document_id,
                event_key=f"current-{target}", event_type=f"document.{target}", to_status=target,
            )
        # Keep the stale instance strongly referenced in this session's map.
        assert cached.status == "draft"
        with pytest.raises(InvalidFiscalTransition, match="submitting -> ready"):
            fiscal_documents.transition_fiscal_document(
                stale, restaurante_id=TENANT, document_id=document_id,
                event_key="stale-ready", event_type="document.ready", to_status="ready",
            )

    with postgres_fiscal.sessions() as db:
        assert db.query(FiscalDocument).one().status == "submitting"
        assert db.query(FiscalEvent).count() == 3
        assert db.query(FiscalEvent).filter(FiscalEvent.event_key == "stale-ready").count() == 0


def test_locked_preflight_refreshes_preloaded_disabled_profile_without_numbering(postgres_fiscal, monkeypatch):
    with postgres_fiscal.sessions() as db:
        db.add(RestaurantFiscalProfile(restaurante_id=TENANT, enabled=True))
        db.commit()
    observed_enabled = []

    def observe_profile(_db, profile, *, mode):
        observed_enabled.append(profile.enabled)
        return SimpleNamespace(
            ready=profile.enabled, mode=mode, jurisdiction_key="BR-CE",
            references=(), compliance_baseline=(),
            issues=() if profile.enabled else (SimpleNamespace(code="profile_disabled"),),
        )

    monkeypatch.setattr(fiscal_issuance, "evaluate_fiscal_preflight", observe_profile)
    with postgres_fiscal.sessions() as stale, postgres_fiscal.sessions() as current:
        cached = stale.query(RestaurantFiscalProfile).filter(
            RestaurantFiscalProfile.restaurante_id == TENANT,
        ).one()
        current_profile = current.query(RestaurantFiscalProfile).filter(
            RestaurantFiscalProfile.restaurante_id == TENANT,
        ).one()
        current_profile.enabled = False
        current.commit()
        assert cached.enabled is True
        values = {key: value for key, value in _request().items()
                  if key not in {"environment", "model", "series", "provider"}}
        with pytest.raises(fiscal_issuance.FiscalPreflightBlocked, match="profile_disabled"):
            fiscal_issuance.create_preflighted_fiscal_document(stale, **values)

    assert observed_enabled == [False]
    with postgres_fiscal.sessions() as db:
        assert db.query(FiscalDocument).count() == 0
        assert db.query(FiscalEvent).count() == 0
        assert db.query(FiscalSequence).count() == 0
