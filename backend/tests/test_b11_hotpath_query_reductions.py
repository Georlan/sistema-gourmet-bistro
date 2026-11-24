from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

from fastapi import HTTPException
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import SessionLocal, current_restaurante_id
from app.main import app
from app.models import (
    Categoria,
    ConfiguracaoRestaurante,
    IntegrationOutbox,
    PrintAgentToken,
    PrintJob,
    Produto,
    Restaurante,
)
from app.routes import print_agents as pa_routes
from app.services import customer_crm
from app.services.outbox.publisher import enqueue_outbox_event_in_session


def test_print_agent_prefilter_rejects_cached_invalid_token_without_db():
    raw_token = "invalid-b11-prefilter-token"
    token_hash = pa_routes.hash_token(raw_token)
    pa_routes._remember_invalid_agent_token(token_hash)
    try:
        with pytest.raises(HTTPException) as exc_info:
            asyncio.run(
                pa_routes._prefilter_agent_token_hash(
                    request=None,
                    x_agent_token=raw_token,
                    authorization=None,
                )
            )
        assert exc_info.value.status_code == 401
    finally:
        pa_routes._forget_invalid_agent_token(token_hash)


def test_claim_pending_jobs_idle_skips_reprint_coalescing(monkeypatch):
    rid = 8841
    now = datetime.now(timezone.utc)
    coalesce_calls: list[int] = []
    monkeypatch.setattr(
        pa_routes,
        "_coalesce_pending_reprints",
        lambda db, rest_id: coalesce_calls.append(rest_id) or 0,
    )
    monkeypatch.setattr(
        pa_routes,
        "_should_run_print_queue_maintenance",
        lambda rest_id: False,
    )

    class _EmptyQuery:
        def filter(self, *args, **kwargs):
            return self

        def first(self):
            return None

    class _FakeDb:
        def query(self, *args, **kwargs):
            return _EmptyQuery()

    agent = SimpleNamespace(restaurante_id=rid, agent_id="agent-idle", is_primary=True)
    result = pa_routes._claim_pending_jobs(_FakeDb(), agent, now, limit=10)
    assert result == []
    assert coalesce_calls == []


def test_complete_batch_noop_skips_commit_and_broadcast(monkeypatch):
    rid = 8842
    already_printed = SimpleNamespace(
        id="job-done-1",
        restaurante_id=rid,
        agent_id="agent-1",
        status="printed",
        printed_at=datetime.now(timezone.utc),
        printer_name="Thermal",
    )
    commits: list[bool] = []
    rollbacks: list[bool] = []
    broadcasts: list[dict] = []

    class _JobQuery:
        def filter(self, *args, **kwargs):
            return self

        def order_by(self, *args, **kwargs):
            return self

        def with_for_update(self):
            return self

        def all(self):
            return [already_printed]

    class _FakeDb:
        def query(self, *args, **kwargs):
            return _JobQuery()

        def commit(self):
            commits.append(True)

        def rollback(self):
            rollbacks.append(True)

    monkeypatch.setattr(
        pa_routes.manager,
        "queue_committed_broadcast",
        lambda db, msg, rest_id, **kw: broadcasts.append(msg),
    )

    req = pa_routes.CompleteJobsRequest(
        jobs=[pa_routes.CompleteJobItem(job_id="job-done-1", printer_name="Thermal")]
    )
    agent = SimpleNamespace(restaurante_id=rid, agent_id="agent-1")
    out = pa_routes.complete_job_batch(req, SimpleNamespace(add_task=lambda *a, **k: None), agent, _FakeDb())
    assert out["confirmed_job_ids"] == ["job-done-1"]
    assert commits == []
    assert rollbacks == [True]
    assert broadcasts == []


def test_crm_schema_available_caches_ready_bind(monkeypatch):
    calls: list[int] = []

    class _FakeInspector:
        def get_table_names(self):
            calls.append(1)
            return list(customer_crm.CRM_TABLE_NAMES)

    fake_bind = SimpleNamespace(dialect=SimpleNamespace(name="postgresql"))

    class _FakeDb:
        def get_bind(self):
            return fake_bind

        def connection(self):
            return fake_bind

    monkeypatch.setattr(customer_crm, "sa_inspect", lambda conn: _FakeInspector())
    try:
        assert customer_crm.crm_schema_available(_FakeDb()) is True
        assert customer_crm.crm_schema_available(_FakeDb()) is True
        assert len(calls) == 1
    finally:
        customer_crm._CRM_SCHEMA_READY_BINDS.discard(id(fake_bind))


def test_outbox_skips_preselect_for_fresh_generated_uuid():
    queries: list[str] = []

    class _FakeDb:
        def __init__(self):
            self.new = set()
            self.info = {}
            self.added = []

        def query(self, *args, **kwargs):
            queries.append("SELECT")
            raise AssertionError("Should not pre-select when event_id is freshly generated")

        def add(self, obj):
            self.added.append(obj)
            self.new.add(obj)

    db = _FakeDb()
    event = {"restaurant_id": 10, "order_id": "ord-1"}
    record = enqueue_outbox_event_in_session(db, event, event_name="koma.test.created")
    assert isinstance(record, IntegrationOutbox)
    assert queries == []
    assert db.info["outbox_pending_notification"] is True


def test_public_menu_supports_weak_etag_and_304():
    rid = 8845
    token = current_restaurante_id.set(rid)
    db = SessionLocal(restaurante_id=rid)
    try:
        if not db.query(Restaurante).filter(Restaurante.id == rid).first():
            db.add(Restaurante(id=rid, nome="ETag Bistro", slug="etag-bistro-8845", plano="pro"))
            db.flush()
            db.add(ConfiguracaoRestaurante(restaurante_id=rid, delivery_ativo=True))
            db.add(Categoria(id="cat-etag-1", restaurante_id=rid, nome="Lanches"))
            db.flush()
            db.add(
                Produto(
                    id="prod-etag-1",
                    restaurante_id=rid,
                    nome="Burger ETag",
                    categoria_id="cat-etag-1",
                    preco=29.9,
                    ativo=True,
                )
            )
            db.commit()
    finally:
        db.close()
        current_restaurante_id.reset(token)

    client = TestClient(app)
    r1 = client.get(f"/api/cardapio-digital/public?restaurante_id={rid}")
    assert r1.status_code == 200
    etag = r1.headers.get("etag")
    assert etag and etag.startswith('W/"')
    assert "max-age=15" in (r1.headers.get("cache-control") or "")

    r2 = client.get(
        f"/api/cardapio-digital/public?restaurante_id={rid}",
        headers={"If-None-Match": etag},
    )
    assert r2.status_code == 304
    assert r2.headers.get("etag") == etag
