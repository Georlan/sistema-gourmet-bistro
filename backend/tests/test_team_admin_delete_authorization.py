from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, current_restaurante_id, get_db
from app.main import app
from app.models import Restaurante, Usuario
from app.security import get_password_hash


DB_FILE = "./test_team_admin_delete_authorization.db"
engine = create_engine(
    f"sqlite:///{DB_FILE}",
    connect_args={"check_same_thread": False, "timeout": 30},
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(autouse=True)
def setup_database():
    tenant_token = current_restaurante_id.set(1)
    app.dependency_overrides[get_db] = override_get_db
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)

    with TestingSessionLocal() as db:
        db.add(Restaurante(id=1, nome="Security Bistro", slug="security-bistro", plano="pro"))
        db.add_all(
            [
                Usuario(
                    id="admin-primary",
                    restaurante_id=1,
                    nome="Admin Primary",
                    email="admin-primary@example.test",
                    senha_hash=get_password_hash("strong-password"),
                    role="admin",
                    cargo="admin",
                    status="ativo",
                ),
                Usuario(
                    id="admin-backup",
                    restaurante_id=1,
                    nome="Admin Backup",
                    email="admin-backup@example.test",
                    senha_hash=get_password_hash("strong-password"),
                    role="admin",
                    cargo="admin",
                    status="ativo",
                ),
                Usuario(
                    id="cashier-operator",
                    restaurante_id=1,
                    nome="Cashier Operator",
                    email="cashier@example.test",
                    senha_hash=get_password_hash("strong-password"),
                    role="caixa",
                    cargo="caixa",
                    status="ativo",
                ),
            ]
        )
        db.commit()

    yield

    app.dependency_overrides.pop(get_db, None)
    current_restaurante_id.reset(tenant_token)
    engine.dispose()
    for suffix in ("", "-wal", "-shm", "-journal"):
        Path(f"{DB_FILE}{suffix}").unlink(missing_ok=True)


def _headers(client: TestClient, email: str) -> dict[str, str]:
    response = client.post(
        "/auth/login",
        json={"username": email, "password": "strong-password"},
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_cashier_cannot_delete_admin_when_another_admin_would_remain():
    client = TestClient(app)
    response = client.delete(
        "/auth/usuarios/admin-primary",
        headers=_headers(client, "cashier@example.test"),
    )

    assert response.status_code == 403, response.text
    assert "Somente administradores" in response.json()["detail"]

    with TestingSessionLocal() as db:
        target = db.query(Usuario).filter(Usuario.id == "admin-primary").one()
        assert target.status == "ativo"


def test_admin_can_delete_another_admin_when_backup_remains():
    client = TestClient(app)
    response = client.delete(
        "/auth/usuarios/admin-primary",
        headers=_headers(client, "admin-backup@example.test"),
    )

    assert response.status_code == 204, response.text
    with TestingSessionLocal() as db:
        assert db.query(Usuario).filter(Usuario.id == "admin-primary").one_or_none() is None
        backup = db.query(Usuario).filter(Usuario.id == "admin-backup").one()
        assert backup.status == "ativo"
