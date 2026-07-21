import os
os.environ["DATABASE_URL"] = "sqlite:///./test_delivery.db"

import pytest
from fastapi.testclient import TestClient
from app.database import SessionLocal, Base, engine, current_restaurante_id
from app.main import app
from app.models import Usuario, Produto, Categoria, Comanda, Motoboy
from app.security import get_password_hash

client = TestClient(app)

@pytest.fixture(scope="module")
def setup_db():
    token_var = current_restaurante_id.set(1)
    try:
        Base.metadata.drop_all(bind=engine)
        Base.metadata.create_all(bind=engine)
        
        db = SessionLocal()
        try:
            # Create category
            cat = Categoria(id="cat-del", restaurante_id=1, nome="Lanches")
            db.add(cat)
            
            # Create product
            prod = Produto(id="p-del", restaurante_id=1, nome="Burguer Simples", categoria_id="cat-del", preco=15.0, ativo=True)
            db.add(prod)
            
            # Create user
            user = Usuario(
                id="u-del-01",
                restaurante_id=1,
                nome="Delivery Agent",
                usuario="delagent",
                senha_hash=get_password_hash("123"),
                role="garcom"
            )
            db.add(user)
            db.commit()
        finally:
            db.close()
            
        yield
        Base.metadata.drop_all(bind=engine)
    finally:
        current_restaurante_id.reset(token_var)


def test_delivery_and_motoboy_flow(setup_db):
    # 1. Login
    login_res = client.post("/auth/login", json={"username": "delagent", "password": "123"})
    assert login_res.status_code == 200
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    
    # 2. Cadastrar Motoboy
    motoboy_payload = {"nome": "Sandro Motos", "telefone": "81 99999-7777"}
    mb_res = client.post("/comandas/motoboys/cadastro", json=motoboy_payload, headers=headers)
    assert mb_res.status_code == 201
    mb_data = mb_res.json()
    assert mb_data["nome"] == "Sandro Motos"
    motoboy_id = mb_data["id"]
    
    # 3. Listar Motoboys
    mbs_res = client.get("/comandas/motoboys/lista", headers=headers)
    assert mbs_res.status_code == 200
    assert len(mbs_res.json()) >= 1
    
    # 4. Criar comanda de Delivery
    comanda_payload = {
        "mesa_id": None,
        "garcom_id": "u-del-01",
        "tipo": "Delivery",
        "identificador": "Carlos Silva",
        "delivery_status": "analise",
        "delivery_telefone": "81 98888-3333",
        "delivery_endereco": "Rua das Flores, 123",
        "delivery_taxa": 6.50
    }
    create_res = client.post("/comandas/", json=comanda_payload, headers=headers)
    assert create_res.status_code == 201
    comanda_data = create_res.json()
    assert comanda_data["tipo"] == "Delivery"
    assert comanda_data["delivery_status"] == "analise"
    assert comanda_data["delivery_telefone"] == "81 98888-3333"
    comanda_id = comanda_data["id"]
    
    # 5. Listar Delivery Ativos
    actives_res = client.get("/comandas/delivery/ativos", headers=headers)
    assert actives_res.status_code == 200
    actives = actives_res.json()
    assert len(actives) >= 1
    assert any(a["id"] == comanda_id for a in actives)
    
    # 6. Atualizar status para producao
    status_res = client.put(f"/comandas/{comanda_id}/delivery/status?status_novo=producao", headers=headers)
    assert status_res.status_code == 200
    assert status_res.json()["delivery_status"] == "producao"
    
    # 7. Despachar com Motoboy
    dispatch_res = client.post(f"/comandas/{comanda_id}/delivery/despachar", json={"motoboy_id": motoboy_id}, headers=headers)
    assert dispatch_res.status_code == 200
    dispatch_data = dispatch_res.json()
    assert dispatch_data["delivery_status"] == "transito"
    assert dispatch_data["motoboy_id"] == motoboy_id
