import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.database import engine, Base, SessionLocal, current_restaurante_id
from app.models import Usuario, Restaurante
from app.security import get_password_hash

client = TestClient(app)

@pytest.fixture(autouse=True)
def setup_auth_user():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    token_var = current_restaurante_id.set(1)
    try:
        # Create test restaurant 1 if missing
        if not db.query(Restaurante).filter(Restaurante.id == 1).first():
            db.add(Restaurante(id=1, nome="Auth Bistro Test", plano="bistro"))
            db.commit()

        # Create active test staff user
        user = db.query(Usuario).filter(Usuario.email == "operador@koma.com").first()
        if not user:
            user = Usuario(
                nome="Operador Caixa",
                email="operador@koma.com",
                senha_hash=get_password_hash("senha123"),
                cargo="caixa",
                role="caixa",
                status="ativo",
                restaurante_id=1
            )
            db.add(user)
            db.commit()
        else:
            user.senha_hash = get_password_hash("senha123")
            user.status = "ativo"
            user.restaurante_id = 1
            db.commit()

        yield
    finally:
        current_restaurante_id.reset(token_var)
        db.close()


def test_auth_login_valid_credentials():
    """1. Autenticação: Login de funcionário com credenciais válidas."""
    response = client.post(
        "/auth/login",
        json={"username": "operador@koma.com", "password": "senha123"}
    )
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data.get("token_type") == "bearer"


def test_auth_login_invalid_password():
    """2. Autenticação: Rejeitar login com senha incorreta."""
    response = client.post(
        "/auth/login",
        json={"username": "operador@koma.com", "password": "senha_errada_999"}
    )
    assert response.status_code == 401
    data = response.json()
    assert "detail" in data


def test_auth_login_nonexistent_user():
    """3. Autenticação: Rejeitar login com usuário inexistente."""
    response = client.post(
        "/auth/login",
        json={"username": "fantasma@koma.com", "password": "senha123"}
    )
    assert response.status_code == 401


def test_auth_protected_endpoint_with_valid_token():
    """4. Autenticação: Acessar endpoint protegido com Bearer token."""
    login_res = client.post(
        "/auth/login",
        json={"username": "operador@koma.com", "password": "senha123"}
    )
    assert login_res.status_code == 200
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    response = client.get("/caixa/turno/atual", headers=headers)
    assert response.status_code == 200
