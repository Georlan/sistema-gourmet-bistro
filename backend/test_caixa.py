import os
os.environ["DATABASE_URL"] = "sqlite:///./test_caixa.db"

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker
import datetime
import uuid

from app.database import Base, get_db
from app.models import Usuario, Produto, Categoria, Mesa, Comanda, Item, Lancamento, CaixaTurno, CaixaMovimentacao, Pagamento
from app.security import get_password_hash
from app.main import app

# Setup test database
SQLALCHEMY_DATABASE_URL = "sqlite:///./test_caixa.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Dependency override
def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()

@pytest.fixture(autouse=True)
def setup_database():
    app.dependency_overrides[get_db] = override_get_db
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    
    # Create test users
    db.add(Usuario(id="u-garcom", nome="Garcom Test", usuario="garcom", senha_hash=get_password_hash("123"), role="garcom"))
    db.add(Usuario(id="u-caixa", nome="Caixa Test", usuario="caixa", senha_hash=get_password_hash("123"), role="caixa"))
    
    # Create category, product, table
    cat = Categoria(id="cat-1", nome="Comida")
    db.add(cat)
    db.add(Produto(id="p-1", nome="Burguer", categoria_id="cat-1", preco=20.0, ativo=True))
    db.add(Mesa(id=1, capacidade=4, nome=None))
    
    db.commit()
    db.close()
    yield
    Base.metadata.drop_all(bind=engine)
    app.dependency_overrides.clear()

def get_auth_headers(client, username, password):
    resp = client.post("/auth/login", json={"username": username, "password": password})
    assert resp.status_code == 200
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}

def test_caixa_permissions():
    client = TestClient(app)
    
    # Log in as garcom (which doesn't have cashier permission)
    headers_garcom = get_auth_headers(client, "garcom", "123")
    
    # Try to open shift (should fail with 403)
    resp = client.post("/caixa/turno/abrir", json={"saldo_inicial": 100.0}, headers=headers_garcom)
    assert resp.status_code == 403
    
    # Log in as caixa (which has permission)
    headers_caixa = get_auth_headers(client, "caixa", "123")
    
    # Open shift (should succeed)
    resp = client.post("/caixa/turno/abrir", json={"saldo_inicial": 150.0}, headers=headers_caixa)
    assert resp.status_code == 201
    assert resp.json()["saldo_inicial"] == 150.0
    assert resp.json()["status"] == "aberto"

def test_caixa_shift_and_movements():
    client = TestClient(app)
    headers = get_auth_headers(client, "caixa", "123")
    
    # 1. Open shift
    resp = client.post("/caixa/turno/abrir", json={"saldo_inicial": 100.0}, headers=headers)
    assert resp.status_code == 201
    
    # 2. Get current shift info
    resp = client.get("/caixa/turno/atual", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "aberto"
    assert data["total_esperado_dinheiro"] == 100.0
    
    # 3. Add Suprimento (R$ 50)
    resp = client.post("/caixa/turno/movimentar", json={"tipo": "suprimento", "valor": 50.0, "descricao": "Troco extra"}, headers=headers)
    assert resp.status_code == 201
    
    # 4. Add Sangria (R$ 20)
    resp = client.post("/caixa/turno/movimentar", json={"tipo": "sangria", "valor": 20.0, "descricao": "Sangria de segurança"}, headers=headers)
    assert resp.status_code == 201
    
    # 5. Check expected totals
    resp = client.get("/caixa/turno/atual", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_esperado_dinheiro"] == 130.0  # 100 + 50 - 20
    
    # 6. Close cashier
    resp = client.post("/caixa/turno/fechar", json={
        "declarado_dinheiro": 130.0,
        "declarado_pix": 0.0,
        "declarado_cartao": 0.0
    }, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "fechado"

def test_caixa_payments():
    client = TestClient(app)
    headers_caixa = get_auth_headers(client, "caixa", "123")
    headers_garcom = get_auth_headers(client, "garcom", "123")
    
    # 1. Create comanda and order items (done by waiter)
    resp = client.post("/comandas/", json={"mesa_id": 1, "garcom_id": "u-garcom", "tipo": "Consumo no Local"}, headers=headers_garcom)
    assert resp.status_code == 201
    comanda_id = resp.json()["id"]
    
    resp = client.post(f"/comandas/{comanda_id}/lancamentos", json={
        "garcom_id": "u-garcom",
        "itens": [
            {"produto_id": "p-1", "observacao": "", "cliente_nome": "Cliente A"},
            {"produto_id": "p-1", "observacao": "", "cliente_nome": "Cliente B"}
        ]
    }, headers=headers_garcom)
    assert resp.status_code == 201
    
    # 2. Try to pay without open shift (should fail with 400)
    resp = client.post(f"/caixa/comandas/{comanda_id}/pagar", json={"valor": 20.0, "metodo": "dinheiro"}, headers=headers_caixa)
    assert resp.status_code == 400
    
    # 3. Open shift
    resp = client.post("/caixa/turno/abrir", json={"saldo_inicial": 100.0}, headers=headers_caixa)
    assert resp.status_code == 201
    
    # Get item IDs
    resp = client.get(f"/comandas/detalhes/todos?fechada=false", headers=headers_garcom)
    assert resp.status_code == 200
    item_id = resp.json()[0]["itens"][0]["id"]
    
    # 3b. Pay inferior value for selected item (R$ 5.00 on R$ 20.00 item)
    # Item should NOT be marked as paid and comanda should remain open
    resp = client.post(f"/caixa/comandas/{comanda_id}/pagar", json={
        "valor": 5.0,
        "metodo": "dinheiro",
        "item_ids": [item_id]
    }, headers=headers_caixa)
    assert resp.status_code == 201
    
    resp = client.get(f"/comandas/detalhes/todos?fechada=false", headers=headers_garcom)
    assert resp.status_code == 200
    comanda = resp.json()[0]
    assert comanda["fechada"] == False
    assert comanda["itens"][0]["pago"] == False
    assert comanda["valor_pago"] == 5.0
    
    # 4. Pay remaining item value (Client A pays for their burguer: R$ 20.00)
    resp = client.post(f"/caixa/comandas/{comanda_id}/pagar", json={
        "valor": 20.0,
        "metodo": "pix",
        "item_ids": [item_id]
    }, headers=headers_caixa)
    assert resp.status_code == 201
    assert resp.json()["valor"] == 20.0
    assert resp.json()["metodo"] == "pix"
    
    # 5. Check comanda is still open but has payment registered
    resp = client.get(f"/comandas/detalhes/todos?fechada=false", headers=headers_garcom)
    assert resp.status_code == 200
    comanda = resp.json()[0]
    assert comanda["fechada"] == False
    assert comanda["valor_pago"] == 25.0
    
    # 6. Settle remaining comanda value (let's pay R$ 19 in cash)
    resp = client.post(f"/caixa/comandas/{comanda_id}/pagar", json={
        "valor": 19.0,
        "metodo": "dinheiro"
    }, headers=headers_caixa)
    assert resp.status_code == 201
    
    # 7. Check comanda is now closed
    resp = client.get(f"/comandas/detalhes/todos?fechada=false", headers=headers_garcom)
    assert resp.status_code == 200
    assert len(resp.json()) == 0  # No open comandas left

def test_manage_tables():
    client = TestClient(app)
    headers = get_auth_headers(client, "caixa", "123")
    
    # 1. Add a new table (Mesa 35, capacity 8)
    resp = client.post("/mesas/", json={"id": 35, "capacidade": 8, "nome": "Mesa Especial"}, headers=headers)
    assert resp.status_code == 201
    assert resp.json()["id"] == 35
    assert resp.json()["capacidade"] == 8
    assert resp.json()["nome"] == "Mesa Especial"
    
    # 2. Add same table number (should fail with 400)
    resp = client.post("/mesas/", json={"id": 35, "capacidade": 4}, headers=headers)
    assert resp.status_code == 400
    
    # 3. Update table capacity and name
    resp = client.put("/mesas/35", json={"capacidade": 10, "nome": "Varanda VIP"}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["capacidade"] == 10
    assert resp.json()["nome"] == "Varanda VIP"
    
    # 4. Delete the table
    resp = client.delete("/mesas/35", headers=headers)
    assert resp.status_code == 204
    
    # 5. Check it was deleted
    resp = client.get("/mesas/35", headers=headers)
    assert resp.status_code == 404


def test_configuracoes_requires_auth_and_admin():
    client = TestClient(app)

    # Anonymous GET should be rejected with 401
    resp = client.get("/caixa/configuracoes")
    assert resp.status_code == 401

    # Garçom token should be rejected with 403 on PUT
    headers_garcom = get_auth_headers(client, "garcom", "123")
    resp = client.put(
        "/caixa/configuracoes",
        json={"taxa_servico_padrao": 12.5},
        headers=headers_garcom
    )
    assert resp.status_code == 403

    # Admin token should be able to update successfully
    db = TestingSessionLocal()
    admin_user = Usuario(id="u-admin", nome="Admin Test", usuario="admin", senha_hash=get_password_hash("123"), role="admin")
    db.add(admin_user)
    db.commit()
    db.close()

    headers_admin = get_auth_headers(client, "admin", "123")
    resp = client.put(
        "/caixa/configuracoes",
        json={"taxa_servico_padrao": 12.5},
        headers=headers_admin
    )
    assert resp.status_code == 200
    assert resp.json()["taxa_servico_padrao"] == 12.5


def test_pagamento_idempotency_race_condition():
    client = TestClient(app)
    headers_caixa = get_auth_headers(client, "caixa", "123")
    headers_garcom = get_auth_headers(client, "garcom", "123")

    # Create a new comanda with a single item
    resp = client.post("/comandas/", json={"mesa_id": 1, "garcom_id": "u-garcom", "tipo": "Consumo no Local"}, headers=headers_garcom)
    assert resp.status_code == 201
    comanda_id = resp.json()["id"]

    resp = client.post(f"/comandas/{comanda_id}/lancamentos", json={
        "garcom_id": "u-garcom",
        "itens": [
            {"produto_id": "p-1", "observacao": "", "cliente_nome": "Cliente A"}
        ]
    }, headers=headers_garcom)
    assert resp.status_code == 201

    resp_turno = client.post("/caixa/turno/abrir", json={"saldo_inicial": 100.0}, headers=headers_caixa)
    assert resp_turno.status_code == 201
    turno_id = resp_turno.json()["id"]

    idempotency_key = "race-test-key-001"
    race_payment_id = f"p-race-{uuid.uuid4().hex[:6]}"
    integrity_error_triggered = False

    original_get_db = app.dependency_overrides.get(get_db)

    def override_get_db_race():
        db = TestingSessionLocal()
        original_commit = db.commit

        def monkey_commit():
            nonlocal integrity_error_triggered
            # Simulate a concurrent transaction inserting the exact same idempotency_key RIGHT BEFORE db.commit()
            db_concurrent = TestingSessionLocal()
            try:
                concurrent_payment = Pagamento(
                    id=race_payment_id,
                    comanda_id=comanda_id,
                    turno_id=turno_id,
                    valor=20.0,
                    metodo="pix",
                    status="aprovado",
                    idempotency_key=idempotency_key,
                    criado_em=datetime.datetime.now(datetime.timezone.utc)
                )
                db_concurrent.add(concurrent_payment)
                db_concurrent.commit()
            finally:
                db_concurrent.close()

            # Now call original commit, which WILL fail with IntegrityError because idempotency_key is UNIQUE
            integrity_error_triggered = True
            original_commit()

        db.commit = monkey_commit
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db_race
    try:
        response = client.post(
            f"/caixa/comandas/{comanda_id}/pagar",
            json={"valor": 20.0, "metodo": "pix", "idempotency_key": idempotency_key},
            headers=headers_caixa
        )
    finally:
        if original_get_db:
            app.dependency_overrides[get_db] = original_get_db
        else:
            app.dependency_overrides.pop(get_db, None)

    assert integrity_error_triggered, "Expected monkey_commit to execute and trigger IntegrityError"
    assert response.status_code == 201
    assert response.json()["idempotency_key"] == idempotency_key
    assert response.json()["id"] == race_payment_id

    db = TestingSessionLocal()
    try:
        count = db.query(Pagamento).filter(Pagamento.idempotency_key == idempotency_key).count()
        assert count == 1
        persisted = db.query(Pagamento).filter(Pagamento.idempotency_key == idempotency_key).first()
        assert persisted.id == race_payment_id
    finally:
        db.close()


def test_cadastrar_e_ativar_funcionario():
    client = TestClient(app)
    headers_caixa = get_auth_headers(client, "caixa", "123")
    
    # 1. Cadastrar funcionário via /caixa/funcionarios
    resp = client.post("/caixa/funcionarios", json={
        "nome": "João Garçom",
        "telefone": "(81) 98888-7777",
        "cargo": "garcom"
    }, headers=headers_caixa)
    assert resp.status_code == 201
    data = resp.json()
    assert data["status"] == "pendente_ativacao"
    assert data["telefone"] == "81988887777"

    # Get token_convite from DB
    db = TestingSessionLocal()
    try:
        user_db = db.query(Usuario).filter(Usuario.telefone == "81988887777").first()
        assert user_db is not None
        assert user_db.token_convite is not None
        token_convite = user_db.token_convite
    finally:
        db.close()

    # 2. Ativar conta via /auth/ativar
    resp_ativar = client.post("/auth/ativar", json={
        "token_convite": token_convite,
        "senha": "minhasenhanova"
    })
    assert resp_ativar.status_code == 200
    data_ativar = resp_ativar.json()
    assert "access_token" in data_ativar

    # 3. Test logging in with newly set password and phone number
    resp_login = client.post("/auth/login", json={
        "username": "81988887777",
        "password": "minhasenhanova"
    })
    assert resp_login.status_code == 200
