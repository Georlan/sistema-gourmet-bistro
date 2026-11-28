import time
from contextlib import asynccontextmanager

import httpx
import pytest
from app.database import engine
from app.main import app as koma
from app.mcp_auth import READ_SCOPE
from app.mcp_edge import METADATA_PATH, install_engineering_mcp
from app.product_catalog import load_product_catalog
from fastapi import FastAPI, WebSocket
from fastapi.testclient import TestClient
from mcp.shared.inbound import CLIENT_CAPABILITIES_META_KEY, PROTOCOL_VERSION_META_KEY
from sqlalchemy import event

ORIGIN = "https://contract.invalid"
ISSUER = "https://issuer.invalid"
RESOURCE = ORIGIN + "/mcp"
TOOL = "ops_get_product_contract"
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


def test_catalog_is_the_only_tool_and_needs_no_db(enabled, issuer):
    def forbid_checkout(*_):
        pytest.fail("Contract lookup opened a database connection")

    event.listen(engine, "checkout", forbid_checkout)
    try:
        tools = rpc(enabled, "tools/list").json()["result"]["tools"]
        assert [t["name"] for t in tools] == [TOOL]
        assert tools[0]["annotations"]["readOnlyHint"]
        result = rpc(enabled, "tools/call", name=TOOL, arguments={}).json()["result"]
        assert not result.get("isError")
        contract = result["structuredContent"]
        expected = load_product_catalog()
        assert contract["future_modules"] == expected["future_modules"]
        assert contract["capabilities"] == expected["capabilities"]
        assert contract["version"] == expected["version"]
        issuer["active"] = False
        assert rpc(enabled, "tools/call", name=TOOL).status_code == 401
    finally:
        event.remove(engine, "checkout", forbid_checkout)


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
