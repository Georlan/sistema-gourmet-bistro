import os
os.environ["DATABASE_URL"] = "sqlite:///./test.db"

import pytest
from fastapi.testclient import TestClient
from app.database import SessionLocal, Base, engine
from app.main import app
from app.models import Garcom, Produto, Categoria, Mesa, Comanda, Item
from app.security import get_password_hash, create_access_token

client = TestClient(app)

@pytest.fixture(scope="module")
def setup_db():
    # Recreate tables for clean testing
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    
    db = SessionLocal()
    try:
        # Create a category
        cat = Categoria(id="cat-1", nome="Bebidas")
        db.add(cat)
        
        # Create products
        p1 = Produto(id="p-1", nome="Coca-Cola", categoria_id="cat-1", preco=5.0, ativo=True)
        p2 = Produto(id="p-2", nome="Cerveja Inativa", categoria_id="cat-1", preco=10.0, ativo=False)
        db.add_all([p1, p2])
        
        # Create a waiter
        garcom = Garcom(
            id="g-1",
            nome="Georlan",
            usuario="georlan",
            senha_hash=get_password_hash("123")
        )
        db.add(garcom)
        
        # Create mesas
        m1 = Mesa(id=1, capacidade=4, nome="Mesa 1")
        m2 = Mesa(id=2, capacidade=6, nome="Mesa 2")
        db.add_all([m1, m2])
        
        db.commit()
    finally:
        db.close()
    
    yield
    
    # Clean up after tests
    Base.metadata.drop_all(bind=engine)

def test_flow(setup_db):
    # 1. Login to get token
    login_response = client.post("/auth/login", json={"username": "georlan", "password": "123"})
    assert login_response.status_code == 200
    token = login_response.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 2. Abrir comanda na Mesa 1
    resp = client.post("/comandas/", json={"mesa_id": 1, "garcom_id": "g-1", "tipo": "Consumo no Local"})
    assert resp.status_code == 201
    comanda1 = resp.json()
    assert comanda1["mesa_id"] == 1
    assert comanda1["numero_pedido"] == 1

    # 3. Abrir outra comanda na Mesa 1 (Dividida por nome) - Deve compartilhar o numero_pedido
    resp = client.post("/comandas/", json={"mesa_id": 1, "garcom_id": "g-1", "tipo": "Consumo no Local", "identificador": "Ana"})
    assert resp.status_code == 201
    comanda2 = resp.json()
    assert comanda2["numero_pedido"] == 1  # Compartilha o número de pedido
    assert comanda2["identificador"] == "Ana"

    # 4. Abrir comanda na Mesa 2 - Deve gerar um novo numero_pedido
    resp = client.post("/comandas/", json={"mesa_id": 2, "garcom_id": "g-1", "tipo": "Consumo no Local"})
    assert resp.status_code == 201
    comanda3 = resp.json()
    assert comanda3["numero_pedido"] == 2

    # 5. Lançar item ativo na comanda 1
    resp = client.post(
        f"/comandas/{comanda1['id']}/lancamentos",
        json={
            "garcom_id": "g-1",
            "itens": [
                {"produto_id": "p-1", "observacao": "Gelo e limão", "cliente_nome": "João"}
            ]
        }
    )
    assert resp.status_code == 201
    lancamento = resp.json()
    assert len(lancamento["itens"]) == 1
    item = lancamento["itens"][0]
    assert item["preco_unit"] == 5.0
    assert item["cliente_nome"] == "João"

    # 6. Tentar lançar item inativo na comanda 1 - Deve falhar
    resp = client.post(
        f"/comandas/{comanda1['id']}/lancamentos",
        json={
            "garcom_id": "g-1",
            "itens": [
                {"produto_id": "p-2", "observacao": ""}
            ]
        }
    )
    assert resp.status_code == 400
    assert "desativado" in resp.json()["detail"]

    # 7. Testar cancelamento pelo Garçom (com token)
    # Tentar cancelar o único item ativo da comanda1 sendo Garçom - Deve falhar!
    resp = client.put(f"/comandas/itens/{item['id']}/cancelar", headers=headers)
    assert resp.status_code == 400
    assert "garçom não pode cancelar" in resp.json()["detail"]

    # 8. Testar cancelamento sem token - Deve ser proibido (401)
    resp = client.put(f"/comandas/itens/{item['id']}/cancelar")
    assert resp.status_code == 401

    # 9. Testar Fechamento e Reabertura sem token - Deve ser proibido (401)
    resp = client.put(f"/comandas/{comanda1['id']}/fechar")
    assert resp.status_code == 401
    
    resp = client.put(f"/comandas/{comanda1['id']}/reabrir")
    assert resp.status_code == 401

    # 10. Testar Fechamento e Reabertura com token - Deve ser permitido (200)
    db = SessionLocal()
    db_comanda = db.query(Comanda).filter(Comanda.id == comanda1['id']).first()
    db_comanda.valor_pago = 10.0
    db.commit()
    db.close()

    resp = client.put(f"/comandas/{comanda1['id']}/fechar", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["fechada"] is True

    resp = client.put(f"/comandas/{comanda1['id']}/reabrir", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["fechada"] is False

    # 11. Testar transferência de comanda
    resp = client.post(f"/comandas/{comanda1['id']}/transferir/2")
    assert resp.status_code == 200
    assert resp.json()["mesa_id"] == 2

    # 12. Testar transferência de item individual
    # Lançar item na comanda 3 (Mesa 2)
    resp = client.post(
        f"/comandas/{comanda3['id']}/lancamentos",
        json={
            "garcom_id": "g-1",
            "itens": [{"produto_id": "p-1", "observacao": "Transferível"}]
        }
    )
    assert resp.status_code == 201
    item_to_transfer = resp.json()["itens"][0]

    # Transferir item para Mesa 1 (que não tem comanda ativa agora, então deve criar uma nova)
    resp = client.post(f"/comandas/itens/{item_to_transfer['id']}/transferir/1")
    assert resp.status_code == 200
    new_item_data = resp.json()
    assert new_item_data["comanda_id"] != comanda3["id"]
    
    # Verificar se a nova comanda da Mesa 1 foi de fato criada no banco e está aberta
    new_comanda_id = new_item_data["comanda_id"]
    resp = client.get(f"/comandas/{new_comanda_id}")
    assert resp.status_code == 200
    assert resp.json()["mesa_id"] == 1
    assert resp.json()["fechada"] is False

