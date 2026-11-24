from __future__ import annotations

import asyncio
from decimal import Decimal
import inspect
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import database as app_db
from app import main as app_main
from app.config import settings
from app.fiscal import reference_watch_runner
from app.models import Base, OnlinePaymentIntent, RestaurantPaymentAccount
from app.routes import websocket as ws_routes
from app.services import signup_notifications
from app.services.online_payments import reconciliation_worker
from app.services.online_payments.base import ProviderPayment
from app.services.online_payments.mercado_pago import MercadoPagoProvider
from app.services.online_payments.pagbank.provider import PagBankProvider
from app.services.online_payments.service import OnlinePaymentService
from app.services.postgres_listen_multiplexer import PostgresListenMultiplexer
from app.signup_models import RestaurantSignup, SignupNotification
from app.websocket_manager import manager


def test_tenant_filtered_models_cached_and_matches_registry():
    expected = tuple(
        mapper.class_
        for mapper in Base.registry.mappers
        if hasattr(mapper.class_, "restaurante_id")
    )
    first = app_db._tenant_filtered_models()
    second = app_db._tenant_filtered_models()
    assert first is second
    assert first == expected


def test_get_db_closes_session_off_event_loop(monkeypatch):
    closed = []
    threadpool_calls = []

    class _FakeSession:
        def close(self):
            closed.append(True)

    async def _fake_run_in_threadpool(func, *args, **kwargs):
        threadpool_calls.append(func.__name__)
        return func(*args, **kwargs)

    monkeypatch.setattr(app_db, "SessionLocal", lambda **kwargs: _FakeSession())
    monkeypatch.setattr(app_db, "run_in_threadpool", _fake_run_in_threadpool)

    async def _exercise():
        gen = app_db.get_db()
        session = await gen.__anext__()
        assert session is not None
        await gen.aclose()

    asyncio.run(_exercise())
    assert threadpool_calls == ["close"]
    assert closed == [True]


def test_pre_ping_fresh_default_and_revalidation_intervals():
    config_src = inspect.getsource(type(settings))
    assert '"DB_PRE_PING_FRESH_SECONDS", "30.0"' in config_src
    assert ws_routes.SESSION_REVALIDATION_SECONDS == 180.0
    assert signup_notifications._WORKER_MAX_IDLE_SECONDS == 300.0


def test_cors_allowed_origins_cached_and_invalidates_on_change(monkeypatch):
    monkeypatch.setattr(settings, "CORS_ALLOWED_ORIGINS", "https://a.example.com")
    first_set = settings.get_cors_allowed_origins_set()
    second_set = settings.get_cors_allowed_origins_set()
    assert first_set is second_set
    assert "https://a.example.com" in first_set

    monkeypatch.setattr(settings, "CORS_ALLOWED_ORIGINS", "https://b.example.com")
    third_set = settings.get_cors_allowed_origins_set()
    assert "https://b.example.com" in third_set
    assert "https://a.example.com" not in third_set


def test_postgres_listen_multiplexer_uses_tcp_keepalives(monkeypatch):
    captured = {}

    class _FakeCursor:
        def execute(self, sql):
            return None

    class _FakeConn:
        autocommit = False

        def cursor(self):
            return _FakeCursor()

    def _fake_connect(dsn, **kwargs):
        captured["dsn"] = dsn
        captured["kwargs"] = kwargs
        return _FakeConn()

    import psycopg2

    monkeypatch.setattr(psycopg2, "connect", _fake_connect)
    mux = PostgresListenMultiplexer(dsn_provider=lambda: "postgresql://u:p@localhost/db")
    mux._open_connection("postgresql://u:p@localhost/db")
    assert captured["kwargs"]["keepalives"] == 1
    assert captured["kwargs"]["keepalives_idle"] == 30
    assert captured["kwargs"]["keepalives_interval"] == 10
    assert captured["kwargs"]["keepalives_count"] == 3


def test_signup_dispatch_batch_skips_commit_when_idle_sqlite(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    RestaurantSignup.__table__.create(engine)
    SignupNotification.__table__.create(engine)
    BaseSession = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    commits = []
    rollbacks = []

    def _session_factory():
        s = BaseSession()
        orig_commit = s.commit
        orig_rollback = s.rollback

        def _commit():
            commits.append(True)
            return orig_commit()

        def _rollback():
            rollbacks.append(True)
            return orig_rollback()

        s.commit = _commit
        s.rollback = _rollback
        return s

    monkeypatch.setattr(signup_notifications, "SessionLocal", _session_factory)
    count = signup_notifications.dispatch_batch()
    assert count == 0
    assert commits == []
    assert len(rollbacks) == 1


def test_websocket_connections_count_counts_all_bucket_sockets(monkeypatch):
    fake_connections = {
        1: {"internal": [object(), object()], "client": [object()]},
        2: {"internal": [object()], "client": []},
    }
    monkeypatch.setattr(manager, "active_connections", fake_connections)
    assert app_main._websocket_connections_count() == 4


def test_payment_providers_close_httpx_clients():
    mp = MercadoPagoProvider("test-token")
    pg = PagBankProvider("test-token", environment="sandbox")
    assert not mp._client.is_closed
    assert not pg._client.is_closed
    mp.close()
    with pg:
        assert not pg._client.is_closed
    assert mp._client.is_closed
    assert pg._client.is_closed


def test_reconcile_provider_payment_releases_pg_transaction_before_http(monkeypatch):
    events: list[str] = []

    class _FakeProvider:
        def get_payment(self, external_payment_id: str) -> ProviderPayment:
            events.append("http_get_payment")
            return ProviderPayment(
                external_id=external_payment_id,
                status="pending",
                amount=Decimal("25.00"),
                external_reference="intent-1",
            )

        def close(self) -> None:
            events.append("provider_close")

    class _FakeQuery:
        def __init__(self, result):
            self._result = result

        def filter(self, *args, **kwargs):
            return self

        def first(self):
            return self._result

    intent = SimpleNamespace(id="intent-1")
    account = SimpleNamespace(
        id="acc-1",
        restaurante_id=10,
        provider="pagbank",
        access_token="tok",
        provider_environment="production",
    )

    class _FakePgDb:
        new = ()
        dirty = ()
        deleted = ()

        def get_bind(self):
            return SimpleNamespace(dialect=SimpleNamespace(name="postgresql"))

        def in_transaction(self):
            return True

        def rollback(self):
            events.append("db_rollback")

        def query(self, model):
            if model is RestaurantPaymentAccount:
                return _FakeQuery(account)
            if model is OnlinePaymentIntent:
                return _FakeQuery(intent)
            return _FakeQuery(None)

        def commit(self):
            events.append("db_commit")

    monkeypatch.setattr(
        "app.services.online_payments.service._provider_adapter",
        lambda acc: _FakeProvider(),
    )
    monkeypatch.setattr(
        OnlinePaymentService,
        "apply_provider_snapshot_in_session",
        classmethod(lambda cls, db, **kwargs: (intent, False)),
    )

    settled, approved = OnlinePaymentService.reconcile_provider_payment(
        _FakePgDb(),
        account=account,
        external_payment_id="ORDE_123",
    )
    assert settled is intent
    assert approved is False
    assert events == ["db_rollback", "http_get_payment", "provider_close", "db_commit"]


def test_reconciliation_worker_exponential_idle_backoff(monkeypatch):
    sleeps: list[float] = []
    outcomes = iter([0, 0, 1, 0])

    monkeypatch.setattr(
        reconciliation_worker,
        "reconcile_pending_intents",
        lambda: next(outcomes),
    )

    async def _fake_sleep(delay: float):
        sleeps.append(delay)
        if len(sleeps) >= 4:
            raise asyncio.CancelledError()

    monkeypatch.setattr(reconciliation_worker.asyncio, "sleep", _fake_sleep)
    asyncio.run(reconciliation_worker.run_worker(poll_interval_seconds=20.0))
    assert sleeps == [40.0, 80.0, 20.0, 40.0]


def test_reference_watch_releases_lock_session_before_http_probes(monkeypatch):
    active_sessions = 0
    sessions_during_probe: list[int] = []

    class _FakeSession:
        def __init__(self):
            nonlocal active_sessions
            active_sessions += 1
            self.closed = False

        def rollback(self):
            return None

        def commit(self):
            return None

        def close(self):
            nonlocal active_sessions
            if not self.closed:
                self.closed = True
                active_sessions -= 1

    monkeypatch.setattr(reference_watch_runner, "SessionLocal", _FakeSession)
    monkeypatch.setattr(reference_watch_runner, "_try_acquire_watch_lock", lambda db: True)

    def _probe(key):
        def _fn():
            sessions_during_probe.append(active_sessions)
            return SimpleNamespace(source_key=key)

        return _fn

    monkeypatch.setattr(reference_watch_runner, "probe_official_ncm", _probe("ncm"))
    monkeypatch.setattr(reference_watch_runner, "probe_nfe_technical_reports", _probe("tech"))
    monkeypatch.setattr(reference_watch_runner, "probe_nfe_portal_notices", _probe("portal"))
    monkeypatch.setattr(
        reference_watch_runner,
        "record_probe",
        lambda db, probe: SimpleNamespace(
            source_key=probe.source_key,
            status="current",
            changed=False,
            observed_version="1",
            observed_sha256="a",
            active_version="1",
            active_sha256="a",
            metadata={},
        ),
    )

    out = reference_watch_runner.run_reference_watch()
    assert out["ok"] is True
    assert sessions_during_probe == [0, 0, 0]
    assert active_sessions == 0
