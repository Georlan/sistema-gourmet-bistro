"""Global event contacts and printer are restricted to platform administrators."""
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.database import get_db
from app.routes import cearatech_leads
from app.security import create_access_token, get_current_user


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("SUPERADMIN_USERNAME", "security-admin")
    app = FastAPI()
    app.include_router(cearatech_leads.router)
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(restaurante_id=101)

    def forbidden_database():
        raise AssertionError("Unauthorized request reached the database")

    app.dependency_overrides[get_db] = forbidden_database
    monkeypatch.setattr(cearatech_leads, "build_cearatech_promo_escpos", forbidden_database)
    return TestClient(app, raise_server_exceptions=False)


@pytest.mark.parametrize("tenant", [101, 202])
@pytest.mark.parametrize("role", ["admin", "garcom", "caixa"])
@pytest.mark.parametrize("path", ["/api/leads/cearatech", "/api/leads/cearatech/print"])
def test_restaurant_accounts_cannot_access_global_contacts_or_printer(client, tenant, role, path):
    token = create_access_token("synthetic-user", tenant, role=role)
    kwargs = {"headers": {"Authorization": f"Bearer {token}"}}
    response = client.post(path, json={"copies": 1}, **kwargs) if path.endswith("print") else client.get(path, **kwargs)
    assert response.status_code == 403


@pytest.mark.parametrize("header", [None, "Bearer invalid"])
def test_missing_or_invalid_authentication_is_rejected(client, header):
    response = client.get("/api/leads/cearatech", headers={"Authorization": header} if header else {})
    assert response.status_code == 401


def test_wrong_platform_identity_is_rejected(client):
    token = create_access_token("other-admin", 0, role="superadmin")
    assert client.get("/api/leads/cearatech", headers={"Authorization": f"Bearer {token}"}).status_code == 401


def test_real_platform_admin_can_list_contacts(client, monkeypatch):
    class CountQuery:
        def filter(self, *args):
            return self
        def with_entities(self, *args):
            return self
        def group_by(self, *args):
            return self
        def scalar(self):
            return 0
        def order_by(self, *args):
            return self
        def offset(self, *args):
            return self
        def limit(self, *args):
            return self
        def all(self):
            return []

    monkeypatch.setattr(cearatech_leads, "funnel_stats", lambda *args: {})
    client.app.dependency_overrides[get_db] = lambda: SimpleNamespace(query=lambda *args: CountQuery())
    token = create_access_token("security-admin", 0, role="superadmin")
    response = client.get("/api/leads/cearatech", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    assert response.json()["leads"] == []
