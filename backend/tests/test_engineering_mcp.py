import time
from contextlib import asynccontextmanager

import httpx
import pytest
from app.database import engine
from app.main import app as koma
from app.mcp_auth import READ_SCOPE
from app.mcp_edge import METADATA_PATH, install_engineering_mcp
from app.mcp_health import build_in_memory_system_health
from app.product_catalog import load_product_catalog
from fastapi import FastAPI, WebSocket
from fastapi.testclient import TestClient
from mcp.shared.inbound import CLIENT_CAPABILITIES_META_KEY, PROTOCOL_VERSION_META_KEY
from sqlalchemy import event

ORIGIN = "https://contract.invalid"
ISSUER = "https://issuer.invalid"
RESOURCE = ORIGIN + "/mcp"
TOOL = "ops_get_product_contract"
HEALTH_TOOL = "ops_get_system_health"
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
        assert [t["name"] for t in tools] == [TOOL, HEALTH_TOOL]
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
