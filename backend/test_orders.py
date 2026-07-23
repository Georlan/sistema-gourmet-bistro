import os
os.environ["DATABASE_URL"] = "sqlite:///./test.db"

import pytest
from fastapi.testclient import TestClient
from app.database import SessionLocal, Base, engine, current_restaurante_id
from app.main import app
from app.models import Garcom, Produto, Categoria, Mesa, Comanda, Item
from app.security import get_password_hash, create_access_token

client = TestClient(app)

@pytest.fixture(scope="module")
def setup_db():
    token_var = current_restaurante_id.set(1)
    try:
        # Recreate tables for clean testing
        Base.metadata.drop_all(bind=engine)
        Base.metadata.create_all(bind=engine)
        
        db = SessionLocal()
        try:
            # Create a category
            cat = Categoria(id="cat-1", restaurante_id=1, nome="Bebidas")
            db.add(cat)
            
            # Create products
            p1 = Produto(id="p-1", restaurante_id=1, nome="Coca-Cola", categoria_id="cat-1", preco=5.0, ativo=True)
            p2 = Produto(id="p-2", restaurante_id=1, nome="Cerveja Inativa", categoria_id="cat-1", preco=10.0, ativo=False)
            db.add_all([p1, p2])
            
            # Create a waiter
            garcom = Garcom(
                id="g-1",
                restaurante_id=1,
                nome="Georlan",
                usuario="georlan",
                senha_hash=get_password_hash("123"),
                cargo="garcom",
                status="ativo",
            )
            caixa = Garcom(
                id="c-1",
                restaurante_id=1,
                nome="Caixa",
                usuario="caixa",
                senha_hash=get_password_hash("123"),
                cargo="caixa",
                status="ativo",
            )
            db.add_all([garcom, caixa])
            
            # Create mesas
            m1 = Mesa(id=1, restaurante_id=1, capacidade=4, nome="Mesa 1")
            m2 = Mesa(id=2, restaurante_id=1, capacidade=6, nome="Mesa 2")
            m3 = Mesa(id=3, restaurante_id=1, capacidade=4, nome="Mesa 3")
            m4 = Mesa(id=4, restaurante_id=1, capacidade=4, nome="Mesa 4")
            m5 = Mesa(id=5, restaurante_id=1, capacidade=4, nome="Mesa 5")
            db.add_all([m1, m2, m3, m4, m5])
            
            db.commit()
        finally:
            db.close()
        
        yield
        
        # Clean up after tests
        Base.metadata.drop_all(bind=engine)
    finally:
        current_restaurante_id.reset(token_var)

def test_flow(setup_db):
    # 1. Login to get token
    login_response = client.post("/auth/login", json={"username": "georlan", "password": "123"})
    assert login_response.status_code == 200
    token = login_response.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 2. Abrir comanda na Mesa 1
    resp = client.post("/comandas/", json={"mesa_id": 1, "garcom_id": "g-1", "tipo": "Consumo no Local"}, headers=headers)
    assert resp.status_code == 201
    comanda1 = resp.json()
    assert comanda1["mesa_id"] == 1
    assert comanda1["numero_pedido"] == 1

    # 3. Abrir outra comanda na Mesa 1 (Dividida por nome) - Deve compartilhar o numero_pedido
    resp = client.post("/comandas/", json={"mesa_id": 1, "garcom_id": "g-1", "tipo": "Consumo no Local", "identificador": "Ana"}, headers=headers)
    assert resp.status_code == 201
    comanda2 = resp.json()
    assert comanda2["numero_pedido"] == 1  # Compartilha o número de pedido
    assert comanda2["identificador"] == "Ana"

    # 4. Abrir comanda na Mesa 2 - Deve gerar um novo numero_pedido
    resp = client.post("/comandas/", json={"mesa_id": 2, "garcom_id": "g-1", "tipo": "Consumo no Local"}, headers=headers)
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
        },
        headers=headers
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
        },
        headers=headers
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

    # 10. Fechamento é operacional, mas reabertura exige caixa/gerente/admin.
    db = SessionLocal()
    db_comanda = db.query(Comanda).filter(Comanda.id == comanda1['id']).first()
    db_comanda.valor_pago = 10.0
    db.commit()
    db.close()

    resp = client.put(f"/comandas/{comanda1['id']}/fechar", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["fechada"] is True

    resp = client.put(f"/comandas/{comanda1['id']}/reabrir", headers=headers)
    assert resp.status_code == 403
    assert resp.json()["detail"].startswith("Acesso negado")

    caixa_login = client.post("/auth/login", json={"username": "caixa", "password": "123"})
    assert caixa_login.status_code == 200
    caixa_headers = {"Authorization": f"Bearer {caixa_login.json()['access_token']}"}

    resp = client.put(f"/comandas/{comanda1['id']}/reabrir", headers=caixa_headers)
    assert resp.status_code == 200
    assert resp.json()["fechada"] is False

    # 11. Testar transferência de comanda
    resp = client.post(f"/comandas/{comanda1['id']}/transferir/2", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["mesa_id"] == 2

    # 12. Testar transferência de item individual
    # Lançar item na comanda 3 (Mesa 2)
    resp = client.post(
        f"/comandas/{comanda3['id']}/lancamentos",
        json={
            "garcom_id": "g-1",
            "itens": [{"produto_id": "p-1", "observacao": "Transferível"}]
        },
        headers=headers
    )
    assert resp.status_code == 201
    item_to_transfer = resp.json()["itens"][0]

    # Transferir item para Mesa 1 (que não tem comanda ativa agora, então deve criar uma nova)
    resp = client.post(f"/comandas/itens/{item_to_transfer['id']}/transferir/1", headers=headers)
    assert resp.status_code == 200
    new_item_data = resp.json()
    assert new_item_data["comanda_id"] != comanda3["id"]
    
    # Verificar se a nova comanda da Mesa 1 foi de fato criada no banco e está aberta
    new_comanda_id = new_item_data["comanda_id"]
    resp = client.get(f"/comandas/{new_comanda_id}", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["mesa_id"] == 1
    assert resp.json()["fechada"] is False


def test_transferir_e_mesclar_limites(setup_db):
    # 1. Login para obter token
    login_response = client.post("/auth/login", json={"username": "georlan", "password": "123"})
    assert login_response.status_code == 200
    token = login_response.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 2. Criar comanda ativa na Mesa 3, Mesa 4 e Mesa 5
    resp3 = client.post("/comandas/", json={"mesa_id": 3, "garcom_id": "g-1", "tipo": "Consumo no Local"}, headers=headers)
    assert resp3.status_code == 201
    comanda3 = resp3.json()

    resp4 = client.post("/comandas/", json={"mesa_id": 4, "garcom_id": "g-1", "tipo": "Consumo no Local"}, headers=headers)
    assert resp4.status_code == 201
    comanda4 = resp4.json()

    resp5 = client.post("/comandas/", json={"mesa_id": 5, "garcom_id": "g-1", "tipo": "Consumo no Local"}, headers=headers)
    assert resp5.status_code == 201
    comanda5 = resp5.json()

    # 3. Mesclar Mesa 3 na Mesa 4 -> Permitido
    resp_merge = client.post("/comandas/mesclar?mesa_origem_id=3&mesa_destino_id=4", headers=headers)
    assert resp_merge.status_code == 200
    assert resp_merge.json()["mesa_id"] == 4
    assert resp_merge.json()["mesa_origem_id"] == 3

    # 4. Tentar mesclar Mesa 5 na Mesa 4 -> Deve ser impedido (limite de 2 mesas excedido na destino)
    resp_merge_fail = client.post("/comandas/mesclar?mesa_origem_id=5&mesa_destino_id=4", headers=headers)
    assert resp_merge_fail.status_code == 400
    assert "Limite de mesclagem atingido" in resp_merge_fail.json()["detail"]

    # 5. Tentar mesclar Mesa 4 (que tem mesclagem de Mesa 3) na Mesa 5 -> Deve ser impedido
    resp_merge_fail2 = client.post("/comandas/mesclar?mesa_origem_id=4&mesa_destino_id=5", headers=headers)
    assert resp_merge_fail2.status_code == 400
    assert "já faz parte de outra mesclagem ativa" in resp_merge_fail2.json()["detail"]

    # 6. Transferir a comanda mesclada (Mesa 4) para a Mesa 5 (que é individual)
    # Isso deve mudar o mesa_id para 5, limpar mesa_origem_id e definir mesa_transferida_de = 4.
    resp_trans = client.post(f"/comandas/{comanda3['id']}/transferir/5", headers=headers)
    assert resp_trans.status_code == 200
    comanda_trans = resp_trans.json()
    assert comanda_trans["mesa_id"] == 5
    assert comanda_trans["mesa_origem_id"] is None
    assert comanda_trans["mesa_transferida_de"] == 4
