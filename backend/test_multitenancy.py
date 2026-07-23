import os
os.environ["DATABASE_URL"] = "sqlite:///./test_multitenancy.db"

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db, current_restaurante_id
from app.models import Restaurante, Usuario, Categoria, Produto, Mesa, Comanda
from app.security import get_password_hash
from app.main import app

# Since DATABASE_URL is set in os.environ, get_db will naturally connect to test_multitenancy.db
# We do NOT override get_db so that the dynamic ContextVar and TenantSession lifecycle is fully tested.

@pytest.fixture(autouse=True)
def setup_database():
    # Retrieve engine directly from database module which is already configured with test_multitenancy.db
    from app.database import engine, SessionLocal
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    
    # 1. Create second restaurant (tenant 1 is automatically created by metadata listener)
    r2 = Restaurante(id=2, nome="A Casa do Hamburguer", plano="pocket")
    db.add(r2)
    db.commit()
    
    # Disable tenant filter temporarily to insert data with custom restaurante_id
    token_var = current_restaurante_id.set(None)
    try:
        # 2. Seed Restaurant 1 Data
        u1 = Usuario(id="u-1", restaurante_id=1, nome="Waiter One", usuario="waiter1", senha_hash=get_password_hash("123"), role="garcom")
        cat1 = Categoria(id="cat-cardapio", restaurante_id=1, nome="Bebidas R1")
        m1 = Mesa(id=1, restaurante_id=1, capacidade=4)
        db.add_all([u1, cat1, m1])
        db.commit()
        
        prod1 = Produto(id="p-principal", restaurante_id=1, nome="Coca R1", categoria_id="cat-cardapio", preco=5.0)
        db.add(prod1)
        db.commit()
        
        # 3. Seed Restaurant 2 Data
        u2 = Usuario(id="u-2", restaurante_id=2, nome="Waiter Two", usuario="waiter2", senha_hash=get_password_hash("123"), role="garcom")
        # Os mesmos IDs de negócio são válidos em outro tenant.
        cat2 = Categoria(id="cat-cardapio", restaurante_id=2, nome="Bebidas R2")
        m2 = Mesa(id=1, restaurante_id=2, capacidade=4)
        db.add_all([u2, cat2, m2])
        db.commit()
        
        prod2 = Produto(id="p-principal", restaurante_id=2, nome="Pepsi R2", categoria_id="cat-cardapio", preco=4.5)
        db.add(prod2)
        db.commit()
    finally:
        current_restaurante_id.reset(token_var)
        
    db.close()

def get_auth_headers(client, username, password):
    resp = client.post("/auth/login", json={"username": username, "password": password})
    assert resp.status_code == 200
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}

def test_logical_isolation_products():
    client = TestClient(app)
    
    # Login as Waiter One (Restaurant 1)
    headers1 = get_auth_headers(client, "waiter1", "123")
    
    # Login as Waiter Two (Restaurant 2)
    headers2 = get_auth_headers(client, "waiter2", "123")
    
    # Query products as Restaurant 1 (FastAPI prefix is /produtos)
    resp1 = client.get("/produtos", headers=headers1)
    assert resp1.status_code == 200
    products1 = resp1.json()
    # Mesmo ID de negócio, conteúdo isolado por restaurante.
    assert len(products1) == 1
    assert products1[0]["id"] == "p-principal"
    assert products1[0]["nome"] == "Coca R1"
    
    # Query products as Restaurant 2
    resp2 = client.get("/produtos", headers=headers2)
    assert resp2.status_code == 200
    products2 = resp2.json()
    # O tenant 2 também pode usar o ID "p-principal".
    assert len(products2) == 1
    assert products2[0]["id"] == "p-principal"
    assert products2[0]["nome"] == "Pepsi R2"

def test_logical_isolation_tables():
    client = TestClient(app)
    
    headers1 = get_auth_headers(client, "waiter1", "123")
    headers2 = get_auth_headers(client, "waiter2", "123")
    
    # Query tables as Restaurant 1
    resp1 = client.get("/mesas", headers=headers1)
    assert resp1.status_code == 200
    tables1 = resp1.json()
    assert len(tables1) == 1
    assert tables1[0]["id"] == 1
    
    # Query tables as Restaurant 2
    resp2 = client.get("/mesas", headers=headers2)
    assert resp2.status_code == 200
    tables2 = resp2.json()
    assert len(tables2) == 1
    assert tables2[0]["id"] == 1


def test_composite_foreign_keys_reject_cross_tenant_links():
    """FKs compostas impedem produto/mesa de apontar para outro restaurante."""
    from app.database import SessionLocal

    token_var = current_restaurante_id.set(None)
    db = SessionLocal()
    try:
        db.add(Categoria(id="cat-exclusiva-r1", restaurante_id=1, nome="Exclusiva R1"))
        db.add(Mesa(id=99, restaurante_id=1, capacidade=2))
        db.commit()

        db.add(Produto(
            id="produto-invalido",
            restaurante_id=2,
            nome="Produto cruzado",
            categoria_id="cat-exclusiva-r1",
            preco=1.0,
        ))
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()

        db.add(Comanda(
            id="comanda-mesa-cruzada",
            restaurante_id=2,
            mesa_id=99,
            garcom_id="u-2",
            numero_pedido=999,
            tipo="Consumo no Local",
        ))
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()
    finally:
        db.close()
        current_restaurante_id.reset(token_var)
