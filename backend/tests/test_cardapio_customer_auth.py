import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.database import engine, Base, SessionLocal, current_restaurante_id
from app.models import Restaurante, Cliente

client = TestClient(app)


@pytest.fixture(autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    token_var = current_restaurante_id.set(101)
    try:
        rest = db.query(Restaurante).filter(Restaurante.id == 101).first()
        if not rest:
            rest = Restaurante(
                id=101,
                nome="Bistrô Teste Auth",
                plano="bistro",
                slug="bistro-teste-auth",
            )
            db.add(rest)
            db.commit()

        # Limpar clientes de teste
        db.query(Cliente).filter(Cliente.restaurante_id == 101).delete()
        db.commit()
    finally:
        current_restaurante_id.reset(token_var)
        db.close()


def test_customer_registration_and_login_flow():
    # 1. Cadastro bem sucedido
    register_payload = {
        "restaurante_id": 101,
        "nome": "Maria Silva",
        "email": "maria@exemplo.com",
        "senha": "senhaSegura123",
        "telefone": "11988887777",
        "endereco": "Rua das Flores, 123",
    }
    res = client.post("/cardapio/clientes/cadastro", json=register_payload)
    assert res.status_code == 201, res.text
    data = res.json()
    assert "access_token" in data
    assert data["cliente"]["nome"] == "Maria Silva"
    assert data["cliente"]["email"] == "maria@exemplo.com"
    assert data["cliente"]["telefone"] == "11988887777"
    assert data["cliente"]["endereco"] == "Rua das Flores, 123"

    token = data["access_token"]

    # 2. Consultar perfil autenticado com o token
    res_me = client.get(
        "/cardapio/clientes/me",
        headers={"X-Koma-Customer-Token": token},
    )
    assert res_me.status_code == 200
    me_data = res_me.json()
    assert me_data["email"] == "maria@exemplo.com"
    assert me_data["nome"] == "Maria Silva"

    # 3. Tentativa de cadastro com mesmo e-mail deve dar 409
    res_dup = client.post("/cardapio/clientes/cadastro", json=register_payload)
    assert res_dup.status_code == 409
    assert "Já existe uma conta com este e-mail" in res_dup.json()["detail"]

    # 4. Login com senha errada deve dar 401
    res_wrong_pw = client.post(
        "/cardapio/clientes/login",
        json={
            "restaurante_id": 101,
            "email": "maria@exemplo.com",
            "senha": "senhaErrada",
        },
    )
    assert res_wrong_pw.status_code == 401

    # 5. Login com sucesso
    res_login = client.post(
        "/cardapio/clientes/login",
        json={
            "restaurante_id": 101,
            "email": "maria@exemplo.com",
            "senha": "senhaSegura123",
        },
    )
    assert res_login.status_code == 200
    login_data = res_login.json()
    assert "access_token" in login_data
    assert login_data["cliente"]["email"] == "maria@exemplo.com"


def test_customer_registration_links_existing_guest_phone():
    # Pre-cria um cliente sem senha (como se fosse um pedido pelo caixa ou guest)
    db = SessionLocal()
    token_var = current_restaurante_id.set(101)
    try:
        guest = Cliente(
            id="guest-uuid-1234",
            restaurante_id=101,
            telefone="11977776666",
            nome="Cliente Balcao",
            saldo_pontos=50,
            saldo_cashback=12.5,
        )
        db.add(guest)
        db.commit()
    finally:
        current_restaurante_id.reset(token_var)
        db.close()

    # O cliente agora se cadastra com esse mesmo telefone
    register_payload = {
        "restaurante_id": 101,
        "nome": "João Santos",
        "email": "joao@exemplo.com",
        "senha": "minhaSenhaForte",
        "telefone": "11977776666",
    }
    res = client.post("/cardapio/clientes/cadastro", json=register_payload)
    assert res.status_code == 201, res.text
    data = res.json()
    assert data["cliente"]["id"] == "guest-uuid-1234"
    assert data["cliente"]["saldo_pontos"] == 50
    assert data["cliente"]["saldo_cashback"] == 12.5
    assert data["cliente"]["email"] == "joao@exemplo.com"

    # Login subsequente funciona
    res_login = client.post(
        "/cardapio/clientes/login",
        json={
            "restaurante_id": 101,
            "email": "joao@exemplo.com",
            "senha": "minhaSenhaForte",
        },
    )
    assert res_login.status_code == 200
