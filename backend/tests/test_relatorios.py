import os
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db, current_restaurante_id
from app.models import Usuario, Produto, Categoria, Comanda, Item, ConfiguracaoRestaurante
from app.security import get_password_hash
from app.main import app

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_relatorios.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
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

        db.add(Usuario(id="u-admin", restaurante_id=1, nome="Admin Test", usuario="admin", senha_hash=get_password_hash("123"), role="admin"))
        db.add(Usuario(id="u-garcom", restaurante_id=1, nome="Garcom Test", usuario="garcom", senha_hash=get_password_hash("123"), role="garcom"))
        db.add(Usuario(id="u-caixa", restaurante_id=1, nome="Caixa Test", usuario="caixa", senha_hash=get_password_hash("123"), role="caixa"))

        cat = Categoria(id=1, restaurante_id=1, nome="Lanches")
        db.add(cat)
        db.add(Produto(id=1, restaurante_id=1, nome="X-Salada", categoria_id=1, preco=25.0, ativo=True))

        db.add(ConfiguracaoRestaurante(restaurante_id=1, meta_mensal=5000.0, taxa_servico_padrao=10.0, taxa_servico_ativa=True))

        db.commit()
        db.close()
        yield
    finally:
        current_restaurante_id.reset(token_var)


def get_auth_headers(client, username, password):
    resp = client.post("/auth/login", json={"username": username, "password": password})
    assert resp.status_code == 200
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_relatorios_full_suite():
    client = TestClient(app)
    headers = get_auth_headers(client, "admin", "123")

    # 1. POST /relatorios/meta-mensal
    resp = client.post("/relatorios/meta-mensal", json={"meta_mensal": 10000.0}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["meta_mensal"] == 10000.0

    # 2. GET /relatorios/visao-geral
    resp = client.get("/relatorios/visao-geral", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "faturamento_total" in data
    assert "total_pedidos" in data
    assert "ticket_medio" in data
    assert "meta_mensal" in data
    assert data["meta_mensal"] == 10000.0
    assert "vendas_por_dia" in data
    assert "horarios_pico" in data

    # 3. GET /relatorios/vendas-detalhes
    resp = client.get("/relatorios/vendas-detalhes", headers=headers)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)

    # 4. GET /relatorios/produtos
    resp = client.get("/relatorios/produtos?ordenacao=mais_vendidos", headers=headers)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)

    # 5. GET /relatorios/equipe/desempenho
    resp = client.get("/relatorios/equipe/desempenho", headers=headers)
    assert resp.status_code == 200
    res = resp.json()
    assert "membros" in res
    assert "taxa_servico_padrao" in res
