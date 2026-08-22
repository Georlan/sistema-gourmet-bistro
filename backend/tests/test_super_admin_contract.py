import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.routes import super_admin
from app.routes.super_admin_services import (
    CloudflareService,
    RailwayService,
    TelegramService,
)
from app.security import create_access_token, get_password_hash


client = TestClient(app)
SUPERADMIN_USERNAME = "owner@example.test"
SUPERADMIN_PASSWORD = "test-password-not-for-production"


@pytest.fixture(autouse=True)
def set_superadmin_env(monkeypatch):
    super_admin.superadmin_login_rate_limiter.history.clear()
    monkeypatch.setenv("SUPERADMIN_USERNAME", SUPERADMIN_USERNAME)
    monkeypatch.setenv(
        "SUPERADMIN_PASSWORD_HASH",
        get_password_hash(SUPERADMIN_PASSWORD),
    )
    yield
    super_admin.superadmin_login_rate_limiter.history.clear()


def _superadmin_headers() -> dict[str, str]:
    token = create_access_token(
        subject=SUPERADMIN_USERNAME,
        restaurante_id=0,
        role="superadmin",
    )
    return {"Authorization": f"Bearer {token}"}


def test_superadmin_login_issues_dedicated_token_but_fake_tenant_list_is_unavailable():
    response = client.post(
        "/api/super-admin/token",
        json={
            "username": SUPERADMIN_USERNAME,
            "password": SUPERADMIN_PASSWORD,
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["token_type"] == "bearer"
    assert isinstance(payload["access_token"], str)
    assert payload["access_token"]

    tenants = client.get(
        "/api/super-admin/restaurantes",
        headers={"Authorization": f"Bearer {payload['access_token']}"},
    )
    assert tenants.status_code == 501
    assert "fonte real" in tenants.json()["detail"].lower()


def test_superadmin_rejects_invalid_credentials():
    response = client.post(
        "/api/super-admin/token",
        json={"username": SUPERADMIN_USERNAME, "password": "wrong-password"},
    )
    assert response.status_code == 401


def test_superadmin_login_is_throttled_before_unbounded_password_attempts():
    for _ in range(8):
        response = client.post(
            "/api/super-admin/token",
            json={"username": SUPERADMIN_USERNAME, "password": "wrong-password"},
        )
        assert response.status_code == 401

    blocked = client.post(
        "/api/super-admin/token",
        json={"username": SUPERADMIN_USERNAME, "password": "wrong-password"},
    )
    assert blocked.status_code == 429


def test_superadmin_rejects_common_user_token_with_403():
    token = create_access_token(subject="staff-test", restaurante_id=1, role="garcom")
    response = client.get(
        "/api/super-admin/restaurantes",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "Acesso restrito a superadministradores."


@pytest.mark.parametrize("environment", ["test", "development", "staging", "production"])
def test_superadmin_never_exposes_simulated_tenants(monkeypatch, environment):
    monkeypatch.setenv("ENVIRONMENT", environment)
    response = client.get(
        "/api/super-admin/restaurantes",
        headers=_superadmin_headers(),
    )
    assert response.status_code == 501
    assert "simulated" not in response.text.lower()


def test_superadmin_source_contains_no_fake_tenants_or_mock_success():
    route_source = (
        Path(__file__).resolve().parents[1] / "app/routes/super_admin.py"
    ).read_text(encoding="utf-8")
    services_source = (
        Path(__file__).resolve().parents[1] / "app/routes/super_admin_services.py"
    ).read_text(encoding="utf-8")

    for marker in (
        "SIMULATED_TENANTS",
        "Pizzaria Sol",
        "Koma Burgers",
        "MOCK_ACTIVE",
        "MOCK_PROVISIONED",
        "DEVELOPMENT MOCK",
    ):
        assert marker not in route_source
        assert marker not in services_source


def test_superadmin_health_never_reports_unverified_integrations_as_green(monkeypatch):
    for name in (
        "SUPABASE_DB_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
        "CLOUDFLARE_API_TOKEN",
        "CLOUDFLARE_ZONE_ID",
        "RAILWAY_API_TOKEN",
        "RAILWAY_PROJECT_ID",
        "GITHUB_TOKEN",
        "SENTRY_DSN",
        "SENTRY_AUTH_TOKEN",
        "TELEGRAM_BOT_TOKEN",
        "TELEGRAM_CHAT_ID",
    ):
        monkeypatch.delenv(name, raising=False)

    response = client.get(
        "/api/super-admin/integrations/health",
        headers=_superadmin_headers(),
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["database"]["status"] == "available"
    assert payload["database"]["source"] == "select_1"
    for service, health in payload.items():
        assert health.get("status") not in {"green", "healthy", "online"}, service
        assert health.get("simulated") is False, service


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("post", "/api/super-admin/restaurantes/onboarding"),
        ("put", "/api/super-admin/restaurantes/tenant-test/status"),
        ("post", "/api/super-admin/git/deploy"),
        ("post", "/api/super-admin/db/backup"),
        ("get", "/api/super-admin/websocket-clients"),
    ],
)
def test_unimplemented_superadmin_actions_fail_explicitly(method, path):
    request_kwargs = {"headers": _superadmin_headers()}
    if path.endswith("onboarding"):
        request_kwargs["json"] = {
            "name": "Tenant Test",
            "plan": "pro",
            "subdomain": "tenant.example.test",
        }
    elif path.endswith("status"):
        request_kwargs["json"] = {"status": "SUSPENDED"}

    response = getattr(client, method)(path, **request_kwargs)
    assert response.status_code == 501
    assert response.json()["detail"]


def test_external_integrations_never_simulate_success_when_unconfigured(monkeypatch):
    for name in (
        "CLOUDFLARE_API_TOKEN",
        "CLOUDFLARE_ZONE_ID",
        "RAILWAY_API_TOKEN",
        "RAILWAY_PROJECT_ID",
        "TELEGRAM_BOT_TOKEN",
        "TELEGRAM_CHAT_ID",
    ):
        monkeypatch.delenv(name, raising=False)

    cname = client.post(
        "/api/super-admin/cloudflare/cname",
        headers=_superadmin_headers(),
        json={"subdomain": "tenant.example.test"},
    )
    telegram = client.post(
        "/api/super-admin/telegram/notify",
        headers=_superadmin_headers(),
        json={"text": "synthetic operational test"},
    )
    connection = client.post(
        "/api/super-admin/test-connection",
        headers=_superadmin_headers(),
        json={"service": "railway"},
    )

    assert cname.status_code == 503
    assert telegram.status_code == 503
    assert connection.status_code == 501


@pytest.mark.anyio
async def test_service_clients_fail_closed_without_credentials():
    cloudflare = CloudflareService(api_token="", zone_id="")
    with pytest.raises(RuntimeError, match="não configurados"):
        await cloudflare.create_cname_record("tenant.example.test")

    railway = RailwayService(api_token="", project_id="")
    with pytest.raises(RuntimeError, match="não configurado"):
        await railway.get_service_metrics()

    telegram = TelegramService(bot_token="", chat_id="")
    with pytest.raises(RuntimeError, match="não configurados"):
        await telegram.send_alert("synthetic test")


def test_credentials_endpoint_returns_only_configuration_booleans():
    response = client.get(
        "/api/super-admin/credentials",
        headers=_superadmin_headers(),
    )
    assert response.status_code == 200
    data = response.json()
    assert set(data) == {
        "sentry",
        "cloudflare",
        "railway",
        "github",
        "telegram",
        "supabase",
    }
    for value in data.values():
        assert value.keys() == {"configured"}
        assert isinstance(value["configured"], bool)


def test_update_credentials_is_unavailable_and_does_not_mutate_environment():
    test_key = "UNSAFE_TEST_CREDENTIAL_KEY"
    os.environ.pop(test_key, None)
    response = client.post(
        "/api/super-admin/credentials",
        headers=_superadmin_headers(),
        json={test_key: "synthetic-secret"},
    )
    assert response.status_code == 501
    assert test_key not in os.environ


def test_security_sensitive_defaults_remain_unset():
    assert not settings.SENTRY_DSN or "ingest.us.sentry.io" not in settings.SENTRY_DSN
