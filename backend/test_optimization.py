import os
os.environ["DATABASE_URL"] = "sqlite:///./test_optimization.db"

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
import datetime

from app.database import Base, get_db, current_restaurante_id
from app.models import Usuario, Produto, Categoria, Mesa, Comanda, Item, Insumo, ConfigFidelizacao, HistoricoFidelidade, ActivityLog, Restaurante, Lancamento
from app.security import get_password_hash
from app.main import app

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_optimization.db"
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
        
        # Create test restaurant if not exists
        existente = db.query(Restaurante).filter(Restaurante.id == 1).first()
        if not existente:
            db.add(Restaurante(id=1, nome="Restaurante Teste"))
            db.commit()
        
        # Create test users
        db.add(Usuario(id="g-1", restaurante_id=1, nome="Mateus Garcom", usuario="mateus", senha_hash=get_password_hash("123"), role="garcom"))
        db.add(Usuario(id="c-1", restaurante_id=1, nome="Caixa Geral", usuario="caixa", senha_hash=get_password_hash("123"), role="caixa"))
        db.add(Usuario(id="m-1", restaurante_id=1, nome="Gerente Geral", usuario="gerente", senha_hash=get_password_hash("123"), role="gerente"))
        
        # Create category, product, table
        cat = Categoria(id="cat-1", restaurante_id=1, nome="Bebidas")
        db.add(cat)
        db.add(Produto(id="p-1", restaurante_id=1, nome="Coca-Cola", categoria_id="cat-1", preco=6.0, ativo=True))
        db.add(Mesa(id=1, restaurante_id=1, capacidade=4, nome=None))
        
        # Pre-populate some inputs
        db.add(Insumo(id="i-1", restaurante_id=1, nome="Pão Brioche", estoque_atual=5.0, estoque_minimo=10.0, estoque_maximo=50.0, unidade_medida="un", preco_medio_custo=1.50))
        db.add(Insumo(id="i-2", restaurante_id=1, nome="Carne Burger", estoque_atual=30.0, estoque_minimo=20.0, estoque_maximo=100.0, unidade_medida="un", preco_medio_custo=4.20))
        
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

def test_peak_hours_pure_sql():
    client = TestClient(app)
    headers = get_auth_headers(client, "caixa", "123")
    db = TestingSessionLocal()
    
    # Create closed comanda
    comanda = Comanda(
        id="com-1", 
        mesa_id=1, 
        garcom_id="g-1", 
        numero_pedido=101, 
        fechada=True, 
        fechado_em=datetime.datetime(2026, 7, 2, 19, 30, 0, tzinfo=datetime.timezone.utc)
    )
    db.add(comanda)
    db.commit()
    
    resp = client.get("/comandas/estatisticas/pico", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) > 0
    assert data[0]["hora"] == "19h"

def test_stock_purchase_suggestions():
    client = TestClient(app)
    headers = get_auth_headers(client, "caixa", "123")
    
    # Retrieve insumos list
    resp = client.get("/estoque/insumos", headers=headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 2
    
    # Retrieve purchase suggestions (reorder point)
    resp = client.get("/estoque/sugestoes", headers=headers)
    assert resp.status_code == 200
    sugestoes = resp.json()
    # Pão Brioche is critical (5 <= 10), Carne Burger is normal (30 > 20)
    assert len(sugestoes) == 1
    assert sugestoes[0]["id"] == "i-1"
    assert sugestoes[0]["quantidade_sugerida"] == 45.0 # max 50 - current 5

def test_unified_fidelity_points_and_cashback():
    client = TestClient(app)
    headers = get_auth_headers(client, "gerente", "123")
    
    # 1. Test config
    resp = client.get("/fidelidade/config", headers=headers)
    assert resp.status_code == 200
    config = resp.json()
    assert config["ativo"] is True
    assert config["tipo_recompensa"] == "PONTOS"
    
    # 2. Accumulate points: R$ 100 purchase. Conversion rate R$ 1 = 1 point.
    resp = client.post("/fidelidade/checkout", json={
        "cliente_telefone": "81987654321",
        "valor_total": 100.0,
        "resgatar": False
    }, headers=headers)
    assert resp.status_code == 200
    res = resp.json()
    assert res["acumulado_nesta_compra"] == 100.0
    assert res["saldo_atual"] == 100.0
    
    # 3. Redeem points: conversion: 100 points = R$ 5 discount (1 point = R$ 0.05)
    resp = client.post("/fidelidade/checkout", json={
        "cliente_telefone": "81987654321",
        "valor_total": 50.0,
        "resgatar": True,
        "pontos_a_resgatar": 100.0
    }, headers=headers)
    assert resp.status_code == 200
    res2 = resp.json()
    assert res2["desconto_aplicado"] == 5.0
    assert res2["valor_final"] == 45.0 # R$ 50 - R$ 5 discount
    # New points accumulated on the R$ 45.0 value: 45 points
    # New balance: 100 (initial) - 100 (redeemed) + 45 (accumulated) = 45 points
    assert res2["saldo_atual"] == 45.0

    # 4. Change config to CASHBACK (5% cashback conversion rate)
    resp = client.post("/fidelidade/config", json={
        "ativo": True,
        "tipo_recompensa": "CASHBACK",
        "taxa_conversao": 5.0,
        "valor_ponto_em_dinheiro": 0.0
    }, headers=headers)
    assert resp.status_code == 200
    
    # 5. Accumulate cashback on new checkout (total = R$ 100)
    resp = client.post("/fidelidade/checkout", json={
        "cliente_telefone": "99988887777",
        "valor_total": 100.0,
        "resgatar": False
    }, headers=headers)
    assert resp.status_code == 200
    res3 = resp.json()
    # 5% of 100 is 5.0 cashback
    assert res3["acumulado_nesta_compra"] == 5.0
    assert res3["saldo_atual"] == 5.0

def test_waiter_commission_report():
    client = TestClient(app)
    headers = get_auth_headers(client, "caixa", "123")
    db = TestingSessionLocal()
    
    # Add a closed comanda with an item
    c = Comanda(id="com-w1", mesa_id=1, garcom_id="g-1", numero_pedido=202, fechada=True)
    db.add(c)
    db.commit()
    
    # Add lancamento with id "none" to satisfy foreign key constraint on Item
    l = Lancamento(id="none", restaurante_id=1, comanda_id="com-w1", garcom_id="g-1")
    db.add(l)
    db.commit()
    
    item = Item(
        id="itm-1",
        restaurante_id=1,
        comanda_id="com-w1",
        lancamento_id="none",
        produto_id="p-1",
        preco_unit=20.0,
        status="entregue",
    )
    db.add(item)
    db.commit()
    
    # Query report
    resp = client.get("/garcons/relatorio", headers=headers)
    assert resp.status_code == 200
    report = resp.json()
    assert len(report) == 1
    assert report[0]["nome_garcon"] == "Mateus Garcom"
    assert report[0]["pedidos_atendidos"] == 1
    # 10% commission on R$ 20.0 is R$ 2.00
    assert report[0]["comissao_acumulada"] == 2.00


def test_manual_clients_and_fidelity_adjustments():
    client = TestClient(app)
    headers = get_auth_headers(client, "caixa", "123")
    
    # 1. Cadastrar cliente manualmente
    resp = client.post("/fidelidade/clientes", json={
        "cliente": "José da Silva",
        "telefone": "81999998888",
        "saldo_pontos": 100
    }, headers=headers)
    assert resp.status_code == 201
    data = resp.json()
    assert data["success"] is True
    
    # 2. Verificar listagem de clientes (GET /fidelidade/clientes)
    resp = client.get("/fidelidade/clientes", headers=headers)
    assert resp.status_code == 200
    clientes = resp.json()
    jose = next((c for c in clientes if c["telefone"] == "81999998888"), None)
    assert jose is not None
    assert jose["cliente"] == "José da Silva"
    assert jose["pontos"] == 100
    assert jose["saldoCashback"] == 100.0
    
    # 3. Editar cliente e ajustar saldo de pontos/cashback (PUT)
    # Vamos mudar o nome para "José da Silva Santos" e diminuir os pontos para 80
    resp = client.put("/fidelidade/clientes/81999998888", json={
        "cliente": "José da Silva Santos",
        "telefone": "81999998888",
        "saldo_pontos": 80
    }, headers=headers)
    assert resp.status_code == 200
    
    # 4. Verificar novos saldos e histórico gerado
    resp = client.get("/fidelidade/clientes", headers=headers)
    assert resp.status_code == 200
    clientes_updated = resp.json()
    jose_updated = next((c for c in clientes_updated if c["telefone"] == "81999998888"), None)
    assert jose_updated["cliente"] == "José da Silva Santos"
    assert jose_updated["pontos"] == 80
    assert jose_updated["saldoCashback"] == 80.0


def test_manual_insumos_and_distribuidores():
    client = TestClient(app)
    headers = get_auth_headers(client, "caixa", "123")
    
    # 1. Cadastrar novo distribuidor manualmente
    resp = client.post("/estoque/distribuidores", json={
        "id": "ambev-test",
        "nome_fantasia": "Ambev Teste",
        "razao_social": "Ambev S/A Teste",
        "cnpj": "12.345.678/0001-90",
        "lead_time_dias": 5
    }, headers=headers)
    if resp.status_code != 201:
        print("DISTRIBUIDOR ERROR RESPONSE:", resp.status_code, resp.json())
        assert False
    dist = resp.json()
    assert dist["id"] == "ambev-test"
    assert dist["nome_fantasia"] == "Ambev Teste"
    
    # 2. Listar distribuidores (GET /estoque/distribuidores)
    resp = client.get("/estoque/distribuidores", headers=headers)
    assert resp.status_code == 200
    dists = resp.json()
    assert len(dists) >= 1
    
    # 3. Editar distribuidor (PUT /estoque/distribuidores/ambev-test)
    resp = client.put("/estoque/distribuidores/ambev-test", json={
        "nome_fantasia": "Ambev Alterado",
        "lead_time_dias": 7
    }, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["nome_fantasia"] == "Ambev Alterado"
    assert resp.json()["lead_time_dias"] == 7
    
    # 4. Cadastrar novo insumo
    resp = client.post("/estoque/insumos", json={
        "id": "insumo-manual-test",
        "nome": "Insumo Teste Manual",
        "estoque_atual": 0.0,
        "estoque_minimo": 15.0,
        "estoque_maximo": 60.0,
        "unidade_medida": "un",
        "preco_medio_custo": 2.50
    }, headers=headers)
    assert resp.status_code == 201 or resp.status_code == 200 # optimization.py save_insumo returns 200
    ins = resp.json()
    assert ins["id"] == "insumo-manual-test"
    assert ins["nome"] == "Insumo Teste Manual"
    assert ins["estoque_atual"] == 0.0
    
    # 5. Ajustar estoque (entrada)
    resp = client.post("/estoque/insumos/insumo-manual-test/ajustar", json={
        "quantidade": 10.0,
        "tipo": "ENTRADA",
        "justificativa": "Ajuste manual inicial"
    }, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["estoque_atual"] == 10.0
    
    # 6. Ajustar estoque (saída)
    resp = client.post("/estoque/insumos/insumo-manual-test/ajustar", json={
        "quantidade": 3.0,
        "tipo": "SAIDA",
        "justificativa": "Perda de teste"
    }, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["estoque_atual"] == 7.0
    
    # 7. Excluir distribuidor (DELETE)
    resp = client.delete("/estoque/distribuidores/ambev-test", headers=headers)
    assert resp.status_code == 204

