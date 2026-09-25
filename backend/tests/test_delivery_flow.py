from unittest.mock import patch
import pytest
from fastapi.testclient import TestClient
from app.database import SessionLocal, Base, engine, current_restaurante_id
from app.main import app
from app.models import Usuario, Produto, Categoria, Comanda, DeliveryCourierReassignmentAudit, Motoboy
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
                role="caixa",
                status="ativo",
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

    opened = client.post(
        "/caixa/turno/abrir",
        json={"saldo_inicial": 0},
        headers=headers,
    )
    assert opened.status_code == 201
    
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
    
    # 4. Criar comanda de Delivery em estado legado "analise".
    # A state machine deve tratá-lo como equivalente a "pendente".
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
    
    # 6. Aceitar: analise/pendente -> producao
    status_res = client.put(f"/comandas/{comanda_id}/delivery/status?status_novo=producao", headers=headers)
    assert status_res.status_code == 200
    assert status_res.json()["delivery_status"] == "producao"

    # A máquina não permite pular produção -> trânsito.
    invalid_dispatch = client.post(
        f"/comandas/{comanda_id}/delivery/despachar",
        json={"motoboy_id": motoboy_id},
        headers=headers,
    )
    assert invalid_dispatch.status_code == 409

    # 7. Produção -> pronto antes do despacho.
    ready_res = client.put(
        f"/comandas/{comanda_id}/delivery/status?status_novo=pronto",
        headers=headers,
    )
    assert ready_res.status_code == 200
    assert ready_res.json()["delivery_status"] == "pronto"

    # 8. Despachar com Motoboy: pronto -> transito
    dispatch_res = client.post(f"/comandas/{comanda_id}/delivery/despachar", json={"motoboy_id": motoboy_id}, headers=headers)
    assert dispatch_res.status_code == 200
    dispatch_data = dispatch_res.json()
    assert dispatch_data["delivery_status"] == "transito"
    assert dispatch_data["motoboy_id"] == motoboy_id

    # 9. Em rota, a troca normal permanece bloqueada.
    second_mb_res = client.post(
        "/comandas/motoboys/cadastro",
        json={"nome": "Lia Entregas", "telefone": "81 99999-8888"},
        headers=headers,
    )
    assert second_mb_res.status_code == 201
    second_motoboy_id = second_mb_res.json()["id"]

    normal_reassign = client.put(
        f"/comandas/{comanda_id}/delivery/entregador",
        json={"motoboy_id": second_motoboy_id},
        headers=headers,
    )
    assert normal_reassign.status_code == 409

    missing_reason = client.post(
        f"/comandas/{comanda_id}/delivery/entregador/reassign",
        json={"motoboy_id": second_motoboy_id, "motivo": ""},
        headers=headers,
    )
    assert missing_reason.status_code == 422

    same_courier = client.post(
        f"/comandas/{comanda_id}/delivery/entregador/reassign",
        json={"motoboy_id": motoboy_id, "motivo": "Correção de teste"},
        headers=headers,
    )
    assert same_courier.status_code == 409

    # 10. A exceção exige motivo, preserva trânsito e não dispara novo despacho.
    with patch("app.routes.orders._agendar_notificacao_whatsapp_status") as customer_status:
        reassigned = client.post(
            f"/comandas/{comanda_id}/delivery/entregador/reassign",
            json={
                "motoboy_id": second_motoboy_id,
                "motivo": "Entregador selecionado por engano",
            },
            headers=headers,
        )

    assert reassigned.status_code == 200, reassigned.text
    assert reassigned.json()["delivery_status"] == "transito"
    assert reassigned.json()["motoboy_id"] == second_motoboy_id
    customer_status.assert_not_called()

    db = SessionLocal(restaurante_id=1)
    try:
        audit = (
            db.query(DeliveryCourierReassignmentAudit)
            .filter(
                DeliveryCourierReassignmentAudit.restaurante_id == 1,
                DeliveryCourierReassignmentAudit.comanda_id == comanda_id,
            )
            .one()
        )
        assert audit.previous_motoboy_id == motoboy_id
        assert audit.new_motoboy_id == second_motoboy_id
        assert audit.previous_motoboy_name == "Sandro Motos"
        assert audit.new_motoboy_name == "Lia Entregas"
        assert audit.actor_user_id == "u-del-01"
        assert audit.reason == "Entregador selecionado por engano"
    finally:
        db.close()
