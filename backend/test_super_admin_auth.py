import os

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.security import create_access_token, get_password_hash

client = TestClient(app)

SUPERADMIN_USERNAME = "superadmin@example.com"
SUPERADMIN_PASSWORD = "supersecret123"

@pytest.fixture(autouse=True)
def set_superadmin_env(monkeypatch):
    monkeypatch.setenv("SUPERADMIN_USERNAME", SUPERADMIN_USERNAME)
    monkeypatch.setenv("SUPERADMIN_PASSWORD_HASH", get_password_hash(SUPERADMIN_PASSWORD))
    yield


def test_superadmin_token_login_and_access():
    payload = {
        "username": SUPERADMIN_USERNAME,
        "password": SUPERADMIN_PASSWORD,
    }

    response = client.post("/api/super-admin/token", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["token_type"] == "bearer"
    assert "access_token" in data
    assert isinstance(data["access_token"], str)
    assert data["access_token"] != ""

    auth_headers = {"Authorization": f"Bearer {data['access_token']}"}
    response = client.get("/api/super-admin/restaurantes", headers=auth_headers)
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_superadmin_rejects_common_user_token_with_403():
    token = create_access_token(subject="garcom_test", restaurante_id=1, role="garcom")
    headers = {"Authorization": f"Bearer {token}"}

    response = client.get("/api/super-admin/restaurantes", headers=headers)
    assert response.status_code == 403
    assert response.json()["detail"] == "Acesso restrito a superadministradores."


def _superadmin_headers() -> dict[str, str]:
    token = create_access_token(
        subject=SUPERADMIN_USERNAME,
        restaurante_id=0,
        role="superadmin",
    )
    return {"Authorization": f"Bearer {token}"}


def test_superadmin_production_never_exposes_simulated_tenants(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")

    response = client.get("/api/super-admin/restaurantes", headers=_superadmin_headers())

    assert response.status_code == 503
    assert "fonte real não configurada" in response.json()["detail"]


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
    ):
        monkeypatch.delenv(name, raising=False)

    response = client.get("/api/super-admin/integrations/health", headers=_superadmin_headers())

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
        ("post", "/api/super-admin/git/deploy"),
        ("post", "/api/super-admin/db/backup"),
        ("get", "/api/super-admin/websocket-clients"),
    ],
)
def test_unimplemented_superadmin_actions_fail_explicitly(method, path):
    response = getattr(client, method)(path, headers=_superadmin_headers())

    assert response.status_code == 501
    assert response.json()["detail"]


def test_connection_test_does_not_return_false_success():
    response = client.post(
        "/api/super-admin/test-connection",
        headers=_superadmin_headers(),
        json={"service": "railway"},
    )

    assert response.status_code == 501
    assert "não implementado" in response.json()["detail"]
