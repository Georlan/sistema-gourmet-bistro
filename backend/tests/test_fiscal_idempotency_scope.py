"""Fiscal replay contracts, with isolated synthetic data and no fiscal API."""
from __future__ import annotations

import copy
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.fiscal_models import FiscalDocument, FiscalEvent, FiscalSequence, RestaurantFiscalProfile
from app.models import Comanda, Restaurante
from app.services import fiscal_issuance
from app.services.fiscal_documents import (
    FiscalDocumentPersistenceError,
    FiscalEventConflict,
    FiscalIdempotencyConflict,
    create_numbered_fiscal_document,
    transition_fiscal_document,
)


@pytest.fixture
def db():
    test_engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(test_engine)
    with Session(test_engine) as session:
        session.add_all([
            Restaurante(id=880091, nome="Fiscal A", plano="pocket"),
            Restaurante(id=880092, nome="Fiscal B", plano="pocket"),
            Comanda(id="own", restaurante_id=880091, garcom_id="synthetic-operator", numero_pedido=1),
            Comanda(id="other", restaurante_id=880092, garcom_id="synthetic-operator", numero_pedido=1),
        ])
        session.commit()
        yield session
    test_engine.dispose()


def _request(**changes):
    values = dict(
        restaurante_id=880091, idempotency_key="sale-1", comanda_id="own",
        sale_snapshot={"saleId": "own", "items": [{"name": "Café", "amount": "12.50"}]},
        total_amount="12.50", environment="homologacao", model="65", series=1,
        provider="direct_sefaz",
    )
    values.update(changes)
    return values


@pytest.mark.parametrize("changes", [
    {"environment": "producao"}, {"series": 2}, {"provider": "other_provider"},
    {"comanda_id": None}, {"total_amount": "13.00"},
    {"sale_snapshot": {"saleId": "own", "items": [{"name": "Outro", "amount": "12.50"}]}},
])
def test_key_reuse_rejects_changed_content_without_number_or_event(db, changes):
    original = create_numbered_fiscal_document(db, **_request()).document
    with pytest.raises(FiscalIdempotencyConflict, match="outro conteúdo ou contexto"):
        create_numbered_fiscal_document(db, **_request(**changes))
    assert db.query(FiscalDocument).count() == 1
    assert db.query(FiscalEvent).count() == 1
    assert db.query(FiscalSequence).one().next_number == 2
    assert original.total_amount == 12.50


def test_reordered_json_and_equivalent_amount_replay_original_snapshot(db):
    values = _request()
    first = create_numbered_fiscal_document(db, **values)
    reordered = {"items": [{"amount": "12.50", "name": "Café"}], "saleId": "own"}
    replay = create_numbered_fiscal_document(db, **_request(sale_snapshot=reordered, total_amount="12.500"))
    assert replay.replayed and replay.document.id == first.document.id
    assert db.query(FiscalSequence).one().next_number == 2


@pytest.mark.parametrize("comanda_id", ["other", "missing"])
def test_comanda_must_belong_to_tenant_before_number_reservation(db, comanda_id):
    with pytest.raises(FiscalDocumentPersistenceError, match="neste restaurante"):
        create_numbered_fiscal_document(db, **_request(comanda_id=comanda_id))
    assert db.query(FiscalDocument).count() == db.query(FiscalSequence).count() == 0


def test_same_key_is_independent_by_tenant(db):
    first = create_numbered_fiscal_document(db, **_request())
    second = create_numbered_fiscal_document(db, **_request(restaurante_id=880092, comanda_id="other"))
    assert first.document.id != second.document.id
    assert first.document.number == second.document.number == 1


@pytest.mark.parametrize("snapshot", [{"value": float("nan")}, {"value": float("inf")}, {"value": object()}])
def test_non_json_or_nonfinite_snapshot_is_rejected_before_numbering(db, snapshot):
    with pytest.raises(FiscalDocumentPersistenceError, match="JSON válido"):
        create_numbered_fiscal_document(db, **_request(sale_snapshot=snapshot))
    assert db.query(FiscalSequence).count() == 0


@pytest.mark.parametrize("changes", [
    {"external_protocol": "different-protocol"}, {"payload": {"rule": "changed"}},
])
def test_event_replay_rejects_changed_protocol_or_payload(db, changes):
    document = create_numbered_fiscal_document(db, **_request()).document
    request = dict(restaurante_id=880091, document_id=document.id, event_key="ready-1",
                   event_type="preflight.passed", to_status="ready", external_protocol="protocol-1",
                   payload={"rule": "v1"})
    first = transition_fiscal_document(db, **request)
    with pytest.raises(FiscalEventConflict, match="protocolo ou conteúdo"):
        transition_fiscal_document(db, **(request | changes))
    replay = transition_fiscal_document(db, **request)
    assert replay.replayed and replay.event.id == first.event.id
    assert db.query(FiscalEvent).count() == 2


def test_preflight_replay_preserves_first_timestamp_but_rechecks_references(db, monkeypatch):
    profile = RestaurantFiscalProfile(restaurante_id=880091, country_code="BR", uf="CE",
                                      document_model="65", environment="homologacao", series=1,
                                      provider="direct_sefaz", enabled=True)
    db.add(profile)
    db.commit()
    ready = SimpleNamespace(ready=True, mode="issuance", jurisdiction_key="BR-CE",
                            references=(), compliance_baseline=())
    calls = []
    monkeypatch.setattr(fiscal_issuance, "evaluate_fiscal_preflight", lambda *_a, **_k: calls.append(1) or ready)
    values = {key: value for key, value in _request().items()
              if key not in {"environment", "model", "series", "provider"}}
    first = fiscal_issuance.create_preflighted_fiscal_document(db, **values)
    frozen = copy.deepcopy(first.document.sale_snapshot)
    replay = fiscal_issuance.create_preflighted_fiscal_document(db, **values)
    assert replay.replayed and replay.document.sale_snapshot == frozen
    assert len(calls) == 2
    ready.jurisdiction_key = "BR-OTHER"
    with pytest.raises(FiscalIdempotencyConflict):
        fiscal_issuance.create_preflighted_fiscal_document(db, **values)
