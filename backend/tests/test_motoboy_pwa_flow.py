import pytest
import uuid
from fastapi.testclient import TestClient
from app.main import app
from app.security import create_access_token, create_motoboy_token, verify_motoboy_token
from app.database import SessionLocal
from app.models import Usuario, Motoboy, Comanda, Item, Produto, Restaurante, Lancamento, Categoria
def get_auth_headers(client, username, password):
    resp = client.post("/auth/login", json={"username": username, "password": password})
    assert resp.status_code == 200, f"Login falhou para {username}: {resp.text}"
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def test_gerar_link_motoboy_flow():
    client = TestClient(app)
    headers = {"Authorization": f"Bearer {create_access_token(subject='u-admin-test', restaurante_id=1, role='admin')}"}

    with SessionLocal() as db:
        admin_usr = db.query(Usuario).filter(Usuario.id == "u-admin-test").first()
        if not admin_usr:
            admin_usr = Usuario(id="u-admin-test", restaurante_id=1, nome="Admin Test", cargo="admin", role="admin", status="ativo")
            db.add(admin_usr)
        else:
            admin_usr.status = "ativo"

        rest = db.query(Restaurante).filter(Restaurante.id == 1).first()
        if not rest:
            rest = Restaurante(id=1, nome="Bistro Test", slug="bistro-test")
            db.add(rest)
        db.commit()

        mb = db.query(Motoboy).filter(Motoboy.id == 10, Motoboy.restaurante_id == 1).first()
        if not mb:
            mb = Motoboy(id=10, restaurante_id=1, nome="Carlos Entregador", telefone="81999998888", ativo=True)
            db.add(mb)
            db.commit()

    # 1. Gerar link para o motoboy 10
    response = client.post("/comandas/motoboys/10/gerar-link", headers=headers)
    assert response.status_code == 200, response.text
    data = response.json()
    assert "token" in data
    assert "link" in data
    assert "/entregador?token=" in data["link"]
    assert data["motoboy_nome"] == "Carlos Entregador"

    token = data["token"]

    # 2. Testar verify_motoboy_token
    payload = verify_motoboy_token(token)
    assert payload["motoboy_id"] == 10
    assert payload["restaurante_id"] == 1

    cmd_id = f"cmd-mb-{uuid.uuid4().hex[:6]}"
    lanc_id = f"lanc-mb-{uuid.uuid4().hex[:6]}"

    # 3. Criar uma comanda em trânsito para o motoboy 10
    with SessionLocal() as db:
        comanda = Comanda(
            id=cmd_id,
            restaurante_id=1,
            garcom_id="u-admin-test",
            numero_pedido=999,
            identificador="Maria Cliente",
            delivery_telefone="81988887777",
            delivery_endereco="Rua Principal, 100",
            delivery_status="transito",
            delivery_taxa=7.50,
            motoboy_id=10,
            fechada=False
        )
        db.add(comanda)

        from app.models import Categoria
        cat = db.query(Categoria).filter(Categoria.restaurante_id == 1).first()
        if not cat:
            cat = Categoria(id=901, restaurante_id=1, nome="Lanches")
            db.add(cat)

        p = db.query(Produto).filter(Produto.restaurante_id == 1).first()
        if not p:
            p = Produto(id="p-901", restaurante_id=1, categoria_id=901, nome="Hamburguer Artesanal", preco=35.0)
            db.add(p)

        lanc = Lancamento(id=lanc_id, restaurante_id=1, comanda_id=cmd_id, garcom_id="u-admin-test")
        db.add(lanc)

        item1 = Item(
            id=f"item-mb-1-{uuid.uuid4().hex[:4]}",
            restaurante_id=1,
            comanda_id=cmd_id,
            lancamento_id=lanc_id,
            produto_id=p.id,
            preco_unit=35.0,
            status="pronto"
        )
        item2 = Item(
            id=f"item-mb-2-{uuid.uuid4().hex[:4]}",
            restaurante_id=1,
            comanda_id=cmd_id,
            lancamento_id=lanc_id,
            produto_id=p.id,
            preco_unit=35.0,
            status="pronto"
        )
        db.add_all([item1, item2])
        db.commit()

    # 4. Acessar painel do entregador com token
    resp_painel = client.get(f"/comandas/motoboys/painel-entregador?token={token}")
    assert resp_painel.status_code == 200, resp_painel.text
    painel_data = resp_painel.json()
    assert painel_data["motoboy"]["nome"] == "Carlos Entregador"
    assert len(painel_data["entregas"]) >= 1

    entrega = next((e for e in painel_data["entregas"] if e["id"] == cmd_id), None)
    assert entrega is not None
    assert entrega["cliente_nome"] == "Maria Cliente"
    assert entrega["delivery_telefone"] == "81988887777"
    assert entrega["delivery_endereco"] == "Rua Principal, 100"
    assert entrega["total"] == 77.50  # 70 + 7.50
    assert entrega["valor_a_cobrar"] == 77.50

    # 5. Entregador confirma a entrega
    resp_confirm = client.post(f"/comandas/motoboys/pedidos/{cmd_id}/confirmar-entrega?token={token}")
    assert resp_confirm.status_code == 200, resp_confirm.text
    assert resp_confirm.json()["status"] == "sucesso"

    # 6. Verificar comanda fechada e finalizada no banco
    with SessionLocal() as db:
        c_check = db.query(Comanda).filter(Comanda.id == cmd_id).first()
        assert c_check.delivery_status == "finalizado"
        assert c_check.fechada is True

    # 7. Testar token inválido
    resp_invalid = client.get("/comandas/motoboys/painel-entregador?token=invalid_token_xyz")
    assert resp_invalid.status_code == 401
