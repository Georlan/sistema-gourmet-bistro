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
