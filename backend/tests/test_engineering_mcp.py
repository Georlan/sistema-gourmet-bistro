import time
from contextlib import asynccontextmanager

import httpx
import pytest
from app.database import Base, SessionLocal, engine
from app.main import app as koma
from app.mcp_auth import READ_SCOPE
from app.mcp_db_guard import (
    MCPBusyError,
    MCPQueryTimeoutError,
    clear_mcp_cache,
    configure_readonly_tx,
    run_protected_db_read,
)
from app.mcp_edge import METADATA_PATH, install_engineering_mcp
from app.mcp_health import build_in_memory_system_health
from app.mcp_ops_queries import (
    get_checkout_outcomes,
    get_print_flow_summary,
    get_restaurant_readiness_summary,
    list_restaurants_operational_summary,
    preview_restaurant_provisioning_readonly,
    verify_tenant_deprovision_readonly,
)
from app.models import Comanda, PrintAgentToken, PrintJob, Restaurante, Usuario
from app.product_catalog import load_product_catalog
from fastapi import FastAPI, WebSocket
from fastapi.testclient import TestClient
from mcp.shared.inbound import CLIENT_CAPABILITIES_META_KEY, PROTOCOL_VERSION_META_KEY
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

ORIGIN = "https://contract.invalid"
ISSUER = "https://issuer.invalid"
RESOURCE = ORIGIN + "/mcp"
TOOL = "ops_get_product_contract"
HEALTH_TOOL = "ops_get_system_health"
CHECKOUT_TOOL = "ops_get_checkout_outcomes"
PRINT_TOOL = "ops_get_print_flow_summary"
VERSION = "2026-07-28"


@pytest.fixture
def enabled(monkeypatch):
    for name, value in {
        "ENABLED": "true",
        "RESOURCE": RESOURCE,
        "ISSUER": ISSUER,
        "CLIENT_ID": "client",
        "OPERATOR_SUB": "operator",
        "INTROSPECTION_SECRET": "test-only",
    }.items():
        monkeypatch.setenv("KOMA_MCP_" + name, value)

    events = []

    @asynccontextmanager
    async def lifespan(app):
        events.append("startup")
        yield {"existing_state": True}
        events.append("shutdown")

    app = FastAPI(lifespan=lifespan)

    @app.websocket("/socket")
    async def socket(ws: WebSocket):
        await ws.accept()
        await ws.send_json(ws.state.existing_state)
        await ws.close()

    @app.get("/mcp-extra")
    async def unrelated():
        return "existing"

    install_engineering_mcp(app)
    with TestClient(app, base_url=ORIGIN) as client:
        yield client
    assert events == ["startup", "shutdown"]


def rpc(client, method, **params):
    headers = {
        "Authorization": "Bearer opaque-fixture",
        "Mcp-Protocol-Version": VERSION,
        "Mcp-Method": method,
        "Accept": "application/json, text/event-stream",
    }
    if "name" in params:
        headers["Mcp-Name"] = params["name"]
    params["_meta"] = {
        PROTOCOL_VERSION_META_KEY: VERSION,
        CLIENT_CAPABILITIES_META_KEY: {},
    }
    return client.post(
        "/mcp",
        headers=headers,
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": params,
        },
    )


@pytest.fixture
def issuer(monkeypatch):
    claims = {
        "active": True,
        "iss": ISSUER,
        "aud": RESOURCE,
        "scope": READ_SCOPE,
        "sub": "operator",
        "client_id": "client",
        "exp": int(time.time()) + 60,
    }

    async def post(self, url, *, headers, data):
        assert url == ISSUER + "/introspect"
        assert headers["Authorization"] == "Bearer test-only"
        assert data == {"token": "opaque-fixture"}
        return httpx.Response(200, json=claims)

    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    return claims


def test_default_entry_point_is_off():
    client = TestClient(koma)
    assert client.get(METADATA_PATH).status_code == 404
    assert client.post("/mcp").status_code == 404


def test_discovery_and_existing_routes(enabled):
    metadata = enabled.get(METADATA_PATH)
    assert metadata.json() == {
        "resource": RESOURCE,
        "authorization_servers": [ISSUER],
        "scopes_supported": [READ_SCOPE],
        "bearer_methods_supported": ["header"],
    }
    rejected = enabled.post("/mcp")
    assert rejected.status_code == 401
    assert ORIGIN + METADATA_PATH in rejected.headers["WWW-Authenticate"]
    assert enabled.get("/mcp-extra").json() == "existing"
    with enabled.websocket_connect("/socket") as ws:
        assert ws.receive_json() is True


def test_catalog_and_health_need_no_db(enabled, issuer):
    def forbid_checkout(*_):
        pytest.fail("Engineering MCP read opened a database connection")

    event.listen(engine, "checkout", forbid_checkout)
    try:
        tools = rpc(enabled, "tools/list").json()["result"]["tools"]
        assert [t["name"] for t in tools] == [
            TOOL,
            HEALTH_TOOL,
            CHECKOUT_TOOL,
            PRINT_TOOL,
            "ops_list_restaurants",
            "ops_get_restaurant_readiness",
            "ops_preview_restaurant_provisioning",
            "ops_verify_tenant_deprovision",
        ]
        assert all(t["annotations"]["readOnlyHint"] for t in tools)
        result = rpc(enabled, "tools/call", name=TOOL, arguments={}).json()["result"]
        assert not result.get("isError")
        contract = result["structuredContent"]
        expected = load_product_catalog()
        assert contract["future_modules"] == expected["future_modules"]
        assert contract["capabilities"] == expected["capabilities"]
        assert contract["version"] == expected["version"]

        health_result = rpc(enabled, "tools/call", name=HEALTH_TOOL, arguments={}).json()["result"]
        assert not health_result.get("isError")
        health = health_result["structuredContent"]
        assert health["overall_status"] in {"normal", "degraded", "unknown"}
        assert isinstance(health["observed_at"], str) and health["observed_at"]
        assert health["coverage"]["db_queries_executed"] == 0
        assert set(health["flows"]) == {"db_pool", "realtime_websocket", "outbox_worker"}

        issuer["active"] = False
        assert rpc(enabled, "tools/call", name=TOOL).status_code == 401
    finally:
        event.remove(engine, "checkout", forbid_checkout)


def test_in_memory_health_states_and_tenant_redaction(monkeypatch):
    from datetime import datetime, timezone
    from types import SimpleNamespace

    from app.database_diagnostics import PoolTelemetry
    from sqlalchemy.pool import QueuePool

    class _FakePool(QueuePool):
        def __init__(self, size_val: int, checked_out_val: int):
            self._size_val = size_val
            self._checked_out_val = checked_out_val

        def size(self):
            return self._size_val

        def checkedout(self):
            return self._checked_out_val

        def overflow(self):
            return 0

    def _make_engine(pool, dialect_name="postgresql"):
        return SimpleNamespace(pool=pool, dialect=SimpleNamespace(name=dialect_name))

    def _make_ws(*, ready: bool, active_connections: dict | None = None):
        bus = SimpleNamespace(
            ready=SimpleNamespace(is_set=lambda: ready),
            generation=2,
            instance_id="abcdef123456",
        )
        return SimpleNamespace(bus=bus, active_connections=active_connections or {})

    fixed_now = datetime(2026, 11, 28, 17, 20, 0, tzinfo=timezone.utc)

    # 1. Normal + zero tenant ID leakage
    pool_ok = _FakePool(4, 1)
    pool_ok._koma_pool_telemetry = PoolTelemetry(pool_ok)
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("ENABLE_OUTBOX_WORKER", "true")
    normal = build_in_memory_system_health(
        target_engine=_make_engine(pool_ok),
        ws_manager=_make_ws(ready=True, active_connections={6: {"internal": [object()]}}),
        outbox_worker=SimpleNamespace(is_running=True, worker_id="worker-01"),
        commit="03daa1c7",
        now=fixed_now,
    )
    assert normal["overall_status"] == "normal"
    assert normal["commit"] == "03daa1c7"
    assert normal["observed_at"] == "2026-11-28T17:20:00+00:00"
    assert normal["flows"]["realtime_websocket"]["active_connections"] == 1
    assert "6" not in str(normal["flows"])
    assert set(normal["flows"]["realtime_websocket"]) == {
        "status",
        "source",
        "active_connections",
        "transport_connected",
        "generation",
        "instance",
    }

    # 2. Degraded (saturated pool + wait timeout + slow wait + bus down + worker stopped)
    pool_bad = _FakePool(4, 4)
    telemetry_bad = PoolTelemetry(pool_bad)
    telemetry_bad.record_wait(600.0, slow=True, timed_out=True)
    pool_bad._koma_pool_telemetry = telemetry_bad
    degraded = build_in_memory_system_health(
        target_engine=_make_engine(pool_bad),
        ws_manager=_make_ws(ready=False),
        outbox_worker=SimpleNamespace(is_running=False, worker_id="worker-01"),
        commit="03daa1c7",
        now=fixed_now,
    )
    assert degraded["overall_status"] == "degraded"
    assert degraded["flows"]["db_pool"]["status"] == "degraded"
    assert degraded["flows"]["realtime_websocket"]["status"] == "degraded"
    assert degraded["flows"]["outbox_worker"]["status"] == "degraded"

    # 3. Unknown (StaticPool / worker disabled by env)
    monkeypatch.setenv("ENVIRONMENT", "test")
    monkeypatch.setenv("ENABLE_OUTBOX_WORKER", "false")
    unknown = build_in_memory_system_health(
        target_engine=_make_engine(SimpleNamespace(), dialect_name="sqlite"),
        ws_manager=SimpleNamespace(bus=None, active_connections={}),
        outbox_worker=SimpleNamespace(is_running=False, worker_id="worker-01"),
        commit="03daa1c7",
        now=fixed_now,
    )
    assert unknown["overall_status"] == "unknown"
    assert unknown["flows"]["db_pool"]["status"] == "unknown"
    assert unknown["flows"]["outbox_worker"]["status"] == "unknown"
    assert unknown["flows"]["outbox_worker"]["reason"] == "disabled_by_environment"


@pytest.mark.parametrize(
    ("change", "status"),
    [
        ({"iss": "other"}, 401),
        ({"aud": RESOURCE + "/"}, 401),
        ({"client_id": "other"}, 401),
        ({"sub": "other"}, 401),
        ({"exp": int(time.time()) - 1}, 401),
        ({"exp": True}, 401),
        ({"active": "true"}, 401),
        ({"scope": "mcp:ops:read-more"}, 403),
    ],
)
def test_rejects_invalid_grants(enabled, issuer, change, status):
    issuer.update(change)
    assert rpc(enabled, "tools/call", name=TOOL).status_code == status


def test_unavailable_issuer_denies_access(enabled, monkeypatch):
    async def timeout(*args, **kwargs):
        raise httpx.ReadTimeout("fixture")

    monkeypatch.setattr(httpx.AsyncClient, "post", timeout)
    assert rpc(enabled, "tools/call", name=TOOL).status_code == 503


def seed_mcp_ops_fixture(db, now):
    from datetime import timedelta

    db.add_all(
        [
            Restaurante(id=101, nome="Restaurante Ficticio Alpha", slug="alpha-secret", plano="pro"),
            Restaurante(id=102, nome="Restaurante Ficticio Beta", slug="beta-secret", plano="pocket"),
        ]
    )
    db.flush()
    db.add_all(
        [
            Usuario(id="u-101", restaurante_id=101, nome="Op Alpha", senha_hash="x", role="admin", cargo="admin", status="ativo"),
            Usuario(id="u-102", restaurante_id=102, nome="Op Beta", senha_hash="x", role="admin", cargo="admin", status="ativo"),
        ]
    )
    db.flush()
    db.add_all(
        [
            Comanda(
                id="c-1",
                restaurante_id=101,
                garcom_id="u-101",
                numero_pedido=1,
                tipo="Delivery",
                delivery_status="aceito",
                online_payment_status="approved",
                criado_em=(now - timedelta(minutes=10)).replace(tzinfo=None),
                onboarding_test=False,
            ),
            Comanda(
                id="c-2",
                restaurante_id=102,
                garcom_id="u-102",
                numero_pedido=2,
                tipo="Delivery",
                delivery_status="pendente",
                online_payment_status="pending",
                criado_em=(now - timedelta(minutes=20)).replace(tzinfo=None),
                onboarding_test=False,
            ),
            Comanda(
                id="c-test",
                restaurante_id=101,
                garcom_id="u-101",
                numero_pedido=3,
                tipo="Delivery",
                delivery_status="recusado",
                online_payment_status="rejected",
                criado_em=(now - timedelta(minutes=5)).replace(tzinfo=None),
                onboarding_test=True,
            ),
        ]
    )
    db.flush()
    db.add_all(
        [
            PrintJob(
                id="pj-1",
                restaurante_id=101,
                document_type="producao",
                destination="COZINHA",
                source_type="pedido",
                source_id="c-1",
                payload_text="CONFIDENTIAL_CUSTOMER_ADDRESS_123",
                status="pending",
                idempotency_key="k1",
                created_at=(now - timedelta(seconds=180)).replace(tzinfo=None),
            ),
            PrintJob(
                id="pj-2",
                restaurante_id=102,
                document_type="producao",
                destination="BAR",
                source_type="pedido",
                source_id="c-2",
                payload_text="CONFIDENTIAL_PAYLOAD_2",
                status="printed",
                idempotency_key="k2",
                created_at=(now - timedelta(minutes=15)).replace(tzinfo=None),
            ),
        ]
    )
    db.add_all(
        [
            PrintAgentToken(
                id="pa-1",
                restaurante_id=101,
                agent_id="caixa-alpha-secret",
                token_hash="sha256-secret-hash",
                ativo=True,
                last_seen_at=(now - timedelta(seconds=20)).replace(tzinfo=None),
            ),
            PrintAgentToken(
                id="pa-2",
                restaurante_id=102,
                agent_id="caixa-beta-secret",
                token_hash="sha256-secret-hash-2",
                ativo=True,
                last_seen_at=(now - timedelta(minutes=10)).replace(tzinfo=None),
            ),
        ]
    )
    db.commit()


def assert_mcp_ops_aggregates(db, now):
    checkout = get_checkout_outcomes(db, window_minutes=60, now=now)
    assert checkout["status"] == "normal"
    assert checkout["tenants_with_activity_count"] == 2
    assert checkout["persisted_orders"]["total"] == 2
    assert checkout["persisted_orders"]["accepted_or_progressed"] == 1
    assert checkout["persisted_orders"]["awaiting_acceptance"] == 1
    assert checkout["persisted_orders"]["refused"] == 0
    assert checkout["online_payments"]["approved"] == 1
    assert checkout["online_payments"]["pending_or_released"] == 1
    assert checkout["coverage"]["pre_persistence_failures_included"] is False
    assert "alpha-secret" not in str(checkout)
    assert "101" not in str(checkout)

    invalid = get_checkout_outcomes(db, window_minutes=7, now=now)
    assert invalid["error"]["code"] == "VALIDATION_ERROR"

    print_summary = get_print_flow_summary(db, now=now)
    assert print_summary["status"] == "degraded"
    assert print_summary["queue"]["pending"] == 1
    assert print_summary["queue"]["delayed_unresolved_jobs"] == 1
    assert print_summary["queue"]["oldest_unresolved_age_seconds"] == 180
    assert print_summary["queue"]["printed_last_60m"] == 1
    assert print_summary["agents"]["active_total"] == 2
    assert print_summary["agents"]["online_within_90s"] == 1
    assert print_summary["agents"]["silent"] == 1
    assert print_summary["physical_output_verified"] is False
    assert print_summary["coverage"]["maintenance_writes_executed"] is False
    for forbidden in ("CONFIDENTIAL", "sha256-secret-hash", "caixa-alpha-secret", "101", "102"):
        assert forbidden not in str(print_summary)


def test_checkout_outcomes_and_print_flow_queries_and_pii_redaction(tmp_path):
    from datetime import datetime, timezone

    db_file = tmp_path / "mcp_ops.db"
    local_engine = create_engine(f"sqlite:///{db_file}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=local_engine)
    LocalSession = sessionmaker(bind=local_engine, autocommit=False, autoflush=False)

    now = datetime(2026, 11, 28, 17, 30, 0, tzinfo=timezone.utc)
    db = LocalSession()
    try:
        seed_mcp_ops_fixture(db, now)
        assert_mcp_ops_aggregates(db, now)
    finally:
        db.close()
        local_engine.dispose()


def test_db_guard_concurrency_cache_timeout_and_readonly():
    import time as pytime
    from types import SimpleNamespace

    import anyio

    clear_mcp_cache()

    # 1. PostgreSQL READ ONLY + statement_timeout SQL emission
    executed = []

    class _FakePGSession:
        def get_bind(self):
            return SimpleNamespace(dialect=SimpleNamespace(name="postgresql"))

        def execute(self, stmt, params=None):
            executed.append((str(stmt), params))

    configure_readonly_tx(_FakePGSession(), statement_timeout_ms=2000)
    assert executed[0][0] == "SET LOCAL TRANSACTION READ ONLY"
    assert executed[1][0] == "SET LOCAL statement_timeout = :ms"
    assert executed[1][1] == {"ms": "2000"}

    # 2. Semaphore fail-fast BUSY + cache hit without re-running DB
    class _DummySession:
        def __init__(self):
            self.closed = False
            self.rolled_back = False

        def get_bind(self):
            return None

        def in_transaction(self):
            return True

        def rollback(self):
            self.rolled_back = True

        def close(self):
            self.closed = True

    sessions = []

    def _make_session():
        s = _DummySession()
        sessions.append(s)
        return s

    async def _run_guard_tests():
        results = []

        async def _slow():
            res = await run_protected_db_read(
                "slow-key",
                lambda db: (pytime.sleep(0.35), {"ok": True})[1],
                ttl_seconds=10.0,
                wait_timeout_seconds=0.1,
                total_timeout_seconds=2.0,
                session_factory=_make_session,
            )
            results.append(("slow", res))

        async def _competing():
            await anyio.sleep(0.05)
            with pytest.raises(MCPBusyError):
                await run_protected_db_read(
                    "other-key",
                    lambda db: {"ok": False},
                    ttl_seconds=0.0,
                    wait_timeout_seconds=0.1,
                    total_timeout_seconds=2.0,
                    session_factory=_make_session,
                )

        async with anyio.create_task_group() as tg:
            tg.start_soon(_slow)
            tg.start_soon(_competing)

        assert results == [("slow", {"ok": True})]
        assert len(sessions) == 1
        assert sessions[0].rolled_back and sessions[0].closed

        # Cache hit must not create a new session
        cached = await run_protected_db_read(
            "slow-key",
            lambda db: {"ok": "should_not_run"},
            ttl_seconds=10.0,
            session_factory=_make_session,
        )
        assert cached == {"ok": True}
        assert len(sessions) == 1

        # Timeout test
        with pytest.raises(MCPQueryTimeoutError):
            await run_protected_db_read(
                "timeout-key",
                lambda db: pytime.sleep(0.25),
                ttl_seconds=0.0,
                total_timeout_seconds=0.05,
                session_factory=_make_session,
            )
        assert sessions[-1].rolled_back and sessions[-1].closed

    anyio.run(_run_guard_tests)


def test_mcp_rpc_calls_new_phase1d_tools(enabled, issuer, monkeypatch):
    import app.mcp_edge as mcp_edge

    clear_mcp_cache()

    async def _fake_read(cache_key, query_fn, **kwargs):
        if cache_key.startswith("checkout_outcomes"):
            return {"status": "normal", "persisted_orders": {"total": 0}}
        return {"status": "normal", "physical_output_verified": False}

    monkeypatch.setattr(mcp_edge, "run_protected_db_read", _fake_read)

    checkout = rpc(enabled, "tools/call", name=CHECKOUT_TOOL, arguments={"window_minutes": 60}).json()["result"]
    assert not checkout.get("isError")
    assert checkout["structuredContent"]["status"] == "normal"

    invalid = rpc(enabled, "tools/call", name=CHECKOUT_TOOL, arguments={"window_minutes": 99}).json()["result"]
    assert invalid["structuredContent"]["error"]["code"] == "VALIDATION_ERROR"

    printing = rpc(enabled, "tools/call", name=PRINT_TOOL, arguments={}).json()["result"]
    assert not printing.get("isError")
    assert printing["structuredContent"]["physical_output_verified"] is False


def test_mcp_operational_restaurant_tools_and_pii_redaction(enabled, issuer, monkeypatch, tmp_path):
    import app.mcp_edge as mcp_edge

    db_file = tmp_path / "mcp_restaurants.db"
    local_engine = create_engine(f"sqlite:///{db_file}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=local_engine)
    LocalSession = sessionmaker(bind=local_engine, autocommit=False, autoflush=False)

    db = LocalSession()
    try:
        db.add(Restaurante(id=201, nome="Pizzaria Teste MCP", slug="pizzaria-mcp", plano="pro", horarios_funcionamento=[{"days": "Todos os dias", "hours": "18:00 - 23:00"}]))
        db.add(Usuario(id="u-201", restaurante_id=201, nome="Dono Secreto", email="secreto@dono.test", telefone="85999998888", senha_hash="x", role="admin", cargo="admin", status="ativo"))
        db.commit()

        listed = list_restaurants_operational_summary(db)
        assert listed["total"] >= 1
        assert any(r["slug"] == "pizzaria-mcp" for r in listed["restaurants"])
        assert "secreto@dono.test" not in str(listed)
        assert "85999998888" not in str(listed)

        readiness = get_restaurant_readiness_summary(db, 201)
        assert readiness["exists"] is True
        assert readiness["steps"]["hours"] is True
        assert "secreto@dono.test" not in str(readiness)

        preview = preview_restaurant_provisioning_readonly(
            db,
            structured_text="Nome: Nova Pizzaria\nSegmento: Pizzaria\nCardápio:\nCalabresa - R$ 49,90",
        )
        assert preview["dryRun"] is True
        assert preview["restaurant"]["slug"] == "nova-pizzaria"
        assert preview["bootstrap"]["productsCount"] == 1

        verified = verify_tenant_deprovision_readonly(db, 999)
        assert verified["tenantId"] == 999
        assert verified["clean"] is True
    finally:
        db.close()
        local_engine.dispose()

    clear_mcp_cache()

    async def _fake_read(cache_key, query_fn, **kwargs):
        if str(cache_key).startswith("restaurants_list"):
            return {"total": 1, "restaurants": [{"id": "201", "slug": "pizzaria-mcp"}]}
        if str(cache_key).startswith("restaurant_readiness"):
            return {"exists": True, "tenantId": "201", "configurationComplete": True}
        if str(cache_key).startswith("tenant_deprovision_verify"):
            return {"tenantId": 999, "clean": True}
        return {"dryRun": True, "readyToProvision": False}

    monkeypatch.setattr(mcp_edge, "run_protected_db_read", _fake_read)

    res_list = rpc(enabled, "tools/call", name="ops_list_restaurants", arguments={"limit": 10}).json()["result"]
    assert res_list["structuredContent"]["total"] == 1

    res_bad_limit = rpc(enabled, "tools/call", name="ops_list_restaurants", arguments={"limit": 0}).json()["result"]
    assert res_bad_limit["structuredContent"]["error"]["code"] == "VALIDATION_ERROR"

    res_readiness = rpc(enabled, "tools/call", name="ops_get_restaurant_readiness", arguments={"tenant_id": 201}).json()["result"]
    assert res_readiness["structuredContent"]["exists"] is True

    res_preview = rpc(enabled, "tools/call", name="ops_preview_restaurant_provisioning", arguments={"name": "Teste"}).json()["result"]
    assert res_preview["structuredContent"]["dryRun"] is True

    res_verify = rpc(enabled, "tools/call", name="ops_verify_tenant_deprovision", arguments={"tenant_id": 999}).json()["result"]
    assert res_verify["structuredContent"]["clean"] is True


def test_readiness_handles_legacy_null_order_types_and_payment_methods(tmp_path):
    from app.models import ConfiguracaoRestaurante

    db_file = tmp_path / "mcp_legacy.db"
    local_engine = create_engine(f"sqlite:///{db_file}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=local_engine)
    LocalSession = sessionmaker(bind=local_engine, autocommit=False, autoflush=False)

    db = LocalSession()
    try:
        db.add(
            Restaurante(
                id=209,
                nome="Loja Legada QA",
                slug="loja-legada-209",
                plano="pro",
                horarios_funcionamento=None,
                formas_pagamento_aceitas=None,
            )
        )
        db.add(
            ConfiguracaoRestaurante(
                restaurante_id=209,
                tipos_pedido_ativos=None,
                delivery_ativo=True,
                taxa_entrega_fixa=0.0,
            )
        )
        db.commit()

        summary = get_restaurant_readiness_summary(db, 209)
        assert summary["exists"] is True
        assert summary["operations"]["orderTypes"] == []
        assert summary["operations"]["legacyOrderTypesUnset"] is True
        assert summary["operations"]["acceptedPaymentMethods"] == []
        assert summary["steps"]["hours"] is False
        assert summary["steps"]["operations"] is False
    finally:
        db.close()
        local_engine.dispose()
