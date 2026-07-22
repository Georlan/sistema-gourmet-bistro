"""
Tests for role-based authorization and user status enforcement.
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db, current_restaurante_id
from app.models import Usuario, Restaurante
from app.security import get_password_hash
from app.main import app

DB_FILE = "./test_authorization.db"
SQLALCHEMY_DATABASE_URL = f"sqlite:///{DB_FILE}"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False, "timeout": 30}
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()


@pytest.fixture(autouse=True)
def setup_database():
    token_var = current_restaurante_id.set(1)
    try:
        app.dependency_overrides[get_db] = override_get_db
        Base.metadata.drop_all(bind=engine)
        Base.metadata.create_all(bind=engine)
        db = TestingSessionLocal()

        db.merge(Restaurante(id=1, nome="Auth Test Bistro", plano="bistro"))
        db.flush()

        # Admin ativo
        db.add(Usuario(
            id="u-admin", restaurante_id=1, nome="Admin Auth",
            usuario="admin", senha_hash=get_password_hash("123"),
            role="admin", cargo="admin", status="ativo"
        ))
        # Garçom ativo
        db.add(Usuario(
            id="u-garcom", restaurante_id=1, nome="Garcom Auth",
            usuario="garcom", senha_hash=get_password_hash("123"),
            role="garcom", cargo="garcom", status="ativo"
        ))
        # Usuário inativo
        db.add(Usuario(
            id="u-inativo", restaurante_id=1, nome="Inativo Auth",
            usuario="inativo", senha_hash=get_password_hash("123"),
            role="garcom", cargo="garcom", status="inativo"
        ))

        db.commit()
        db.close()
        yield
    finally:
        current_restaurante_id.reset(token_var)
        import os
        try:
            engine.dispose()
            os.remove(DB_FILE)
        except Exception:
            pass


def get_auth_headers(client, username, password):
    resp = client.post("/auth/login", json={"username": username, "password": password})
    assert resp.status_code == 200, f"Login falhou para {username}: {resp.text}"
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def test_garcom_blocked_from_relatorios():
    """Garçom deve receber HTTP 403 ao tentar acessar relatórios."""
    client = TestClient(app)
    headers = get_auth_headers(client, "garcom", "123")

    resp = client.get("/relatorios/visao-geral", headers=headers)
    assert resp.status_code == 403, f"Esperado 403, obteve {resp.status_code}"
    assert "Acesso negado" in resp.json()["detail"]


def test_admin_allowed_relatorios():
    """Admin deve acessar relatórios normalmente."""
    client = TestClient(app)
    headers = get_auth_headers(client, "admin", "123")

    resp = client.get("/relatorios/visao-geral", headers=headers)
    assert resp.status_code == 200


def test_inactive_user_blocked():
    """Usuário inativo deve ter acesso bloqueado (HTTP 403)."""
    client = TestClient(app)
    headers = get_auth_headers(client, "inativo", "123")

    resp = client.get("/comandas/", headers=headers)
    assert resp.status_code == 403, f"Esperado 403, obteve {resp.status_code}"
    assert "inativa ou bloqueada" in resp.json()["detail"]
