import os
os.environ["DATABASE_URL"] = "sqlite:///./test_estoque_ampliado.db"

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.models import Restaurante, Usuario, Insumo, Distribuidor, EntradaEstoque, MovimentacaoEstoque, SessaoContagemEstoque
from app.security import get_password_hash, create_access_token
from app.main import app

client = TestClient(app)

@pytest.fixture(autouse=True)
def setup_database():
    # Setup test DB tables before each test
    from app.database import engine
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)

    # Seed test tenants and users
    db = sessionmaker(autocommit=False, autoflush=False, bind=engine)()
    
    rest1 = Restaurante(id=10, nome="Restaurante Alfa", slug="alfa")
    rest2 = Restaurante(id=20, nome="Restaurante Beta", slug="beta")
    db.add_all([rest1, rest2])
    db.commit()

    user_alfa = Usuario(
        id="usr-alfa",
        restaurante_id=10,
        nome="Operador Alfa",
        usuario="alfa_op",
        senha_hash=get_password_hash("senha123"),
        role="caixa"
    )
    user_beta = Usuario(
        id="usr-beta",
        restaurante_id=20,
        nome="Operador Beta",
        usuario="beta_op",
        senha_hash=get_password_hash("senha123"),
        role="caixa"
    )
    db.add_all([user_alfa, user_beta])
    db.commit()

    # Seed Insumo for Alfa
    insumo_alfa = Insumo(
        id="ins-carne",
        restaurante_id=10,
        nome="Picanha Bovina",
        estoque_atual=10.0,
        estoque_minimo=5.0,
        estoque_maximo=50.0,
        unidade_medida="kg",
        preco_medio_custo=60.0
    )
    # Seed Insumo for Beta
    insumo_beta = Insumo(
        id="ins-carne-beta",
        restaurante_id=20,
        nome="Picanha Bovina Beta",
        estoque_atual=5.0,
        estoque_minimo=2.0,
        estoque_maximo=20.0,
        unidade_medida="kg",
        preco_medio_custo=70.0
    )
    db.add_all([insumo_alfa, insumo_beta])
    db.commit()
    db.close()
    yield

def get_auth_header(usuario: str = "alfa_op"):
    res = client.post("/auth/login", json={"username": usuario, "password": "senha123"})
    assert res.status_code == 200, f"Login failed for {usuario}: {res.text}"
    token = res.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}

# 1. Test manual entry with 1 item & multiple items + weighted cost recalculation
def test_entrada_manual_uma_e_multiplas():
    headers = get_auth_header()

    # Entry 1: Single item (10kg of ins-carne @ R$ 80.00)
    # Previous stock = 10kg @ R$ 60.00. Total stock = 20kg.
    # Expected weighted cost = ((10 * 60) + (10 * 80)) / 20 = 1400 / 20 = 70.00
    payload1 = {
        "distribuidor_nome_fantasia": "Frigorífico Boi Gordo",
        "numero_documento": "NF-1001",
        "data_emissao": "2026-07-22",
        "observacao": "Recebimento no turno da manhã",
        "itens": [
            {
                "insumo_id": "ins-carne",
                "quantidade": 10.0,
                "unidade_medida": "kg",
                "custo_unitario": 80.0
            }
        ]
    }
    res1 = client.post("/estoque/entradas/manual", json=payload1, headers=headers)
    assert res1.status_code == 201
    data1 = res1.json()
    assert data1["numero_documento"] == "NF-1001"
    assert data1["valor_total"] == 800.0

    # Verify insumo stock and weighted cost updated
    res_ins = client.get("/estoque/insumos", headers=headers)
    ins = next(i for i in res_ins.json() if i["id"] == "ins-carne")
    assert ins["estoque_atual"] == 20.0
    assert ins["preco_medio_custo"] == 70.0

    # Entry 2: Multiple items (with 1 new inline insumo)
    payload2 = {
        "numero_documento": "NF-1002",
        "itens": [
            {
                "insumo_id": "ins-carne",
                "quantidade": 10.0,
                "unidade_medida": "kg",
                "custo_unitario": 100.0
            },
            {
                "insumo_id": "ins-arroz",
                "insumo_nome": "Arroz Agulhinha 5kg",
                "quantidade": 5.0,
                "unidade_medida": "un",
                "custo_unitario": 25.0
            }
        ]
    }
    res2 = client.post("/estoque/entradas/manual", json=payload2, headers=headers)
    assert res2.status_code == 201

    # Check updated insumo stock: 20 + 10 = 30kg. New cost = ((20 * 70) + (10 * 100)) / 30 = 2400 / 30 = 80.0
    res_ins2 = client.get("/estoque/insumos", headers=headers)
    ins_carne = next(i for i in res_ins2.json() if i["id"] == "ins-carne")
    assert ins_carne["estoque_atual"] == 30.0
    assert ins_carne["preco_medio_custo"] == 80.0

    # Check new inline insumo created
    ins_arroz = next((i for i in res_ins2.json() if i["nome"] == "Arroz Agulhinha 5kg"), None)
    assert ins_arroz is not None
    assert ins_arroz["estoque_atual"] == 5.0

# 2. Test rollback on transaction failure
def test_rollback_transacao_falha():
    headers = get_auth_header()

    # Payload with invalid insumo ID that doesn't exist and has no inline name
    invalid_payload = {
        "numero_documento": "NF-FAIL",
        "itens": [
            {
                "insumo_id": "ins-inexistente-sem-nome",
                "quantidade": 10.0,
                "custo_unitario": 50.0
            }
        ]
    }
    res = client.post("/estoque/entradas/manual", json=invalid_payload, headers=headers)
    assert res.status_code == 404

    # Verify no entry was created in DB
    res_ent = client.get("/estoque/entradas", headers=headers)
    assert len(res_ent.json()) == 0

# 3. Test loss, positive adjustment, negative adjustment
def test_movimentacao_perda_e_ajustes():
    headers = get_auth_header()

    # Loss movement: 2kg loss of ins-carne (stock: 10kg ➔ 8kg)
    payload_perda = {
        "insumo_id": "ins-carne",
        "tipo": "perda",
        "quantidade": 2.0,
        "motivo": "Validade vencida"
    }
    res_perda = client.post("/estoque/movimentacoes", json=payload_perda, headers=headers)
    assert res_perda.status_code == 201
    mov_perda = res_perda.json()
    assert mov_perda["saldo_anterior"] == 10.0
    assert mov_perda["saldo_posterior"] == 8.0

    # Positive adjustment: +5kg (stock: 8kg ➔ 13kg)
    payload_pos = {
        "insumo_id": "ins-carne",
        "tipo": "ajuste_positivo",
        "quantidade": 5.0,
        "motivo": "Sobra encontrada na câmara fria"
    }
    res_pos = client.post("/estoque/movimentacoes", json=payload_pos, headers=headers)
    assert res_pos.status_code == 201
    mov_pos = res_pos.json()
    assert mov_pos["saldo_posterior"] == 13.0

    # Negative adjustment: -3kg (stock: 13kg ➔ 10kg)
    payload_neg = {
        "insumo_id": "ins-carne",
        "tipo": "ajuste_negativo",
        "quantidade": 3.0,
        "motivo": "Correção de lançamento"
    }
    res_neg = client.post("/estoque/movimentacoes", json=payload_neg, headers=headers)
    assert res_neg.status_code == 201
    mov_neg = res_neg.json()
    assert mov_neg["saldo_posterior"] == 10.0

    # Verify weighted cost remained unchanged (R$ 60.00)
    res_ins = client.get("/estoque/insumos", headers=headers)
    ins = next(i for i in res_ins.json() if i["id"] == "ins-carne")
    assert ins["preco_medio_custo"] == 60.0

# 4. Test negative stock prevention
def test_bloqueio_saldo_negativo():
    headers = get_auth_header()

    # Attempt to lose 15kg of ins-carne when stock is only 10kg
    payload = {
        "insumo_id": "ins-carne",
        "tipo": "perda",
        "quantidade": 15.0,
        "motivo": "Perda excessiva"
    }
    res = client.post("/estoque/movimentacoes", json=payload, headers=headers)
    assert res.status_code == 400
    assert "insuficiente" in res.json()["detail"].lower()

# 5. Test movement filters
def test_filtros_movimentacao():
    headers = get_auth_header()

    # Create loss & positive adjustment
    client.post("/estoque/movimentacoes", json={"insumo_id": "ins-carne", "tipo": "perda", "quantidade": 1.0, "motivo": "Perda 1"}, headers=headers)
    client.post("/estoque/movimentacoes", json={"insumo_id": "ins-carne", "tipo": "ajuste_positivo", "quantidade": 2.0, "motivo": "Ajuste 1"}, headers=headers)

    # Filter by tipo=perda
    res_perda = client.get("/estoque/movimentacoes?tipo=perda", headers=headers)
    assert res_perda.status_code == 200
    assert len(res_perda.json()) == 1
    assert res_perda.json()[0]["tipo"] == "perda"

# 6. Test physical count session (partial count, draft, confirmation & difference adjustment)
def test_contagem_parcial_e_completa():
    headers = get_auth_header()

    # Stock of ins-carne is 10.0kg. Physical count finds 12.0kg (diff: +2.0)
    payload_draft = {
        "observacao": "Inventário semanal rascunho",
        "status": "rascunho",
        "itens": [
            {
                "insumo_id": "ins-carne",
                "quantidade_contada": 12.0
            }
        ]
    }
    res_draft = client.post("/estoque/contagens", json=payload_draft, headers=headers)
    assert res_draft.status_code == 201
    cont_data = res_draft.json()
    assert cont_data["status"] == "rascunho"
    assert cont_data["itens"][0]["diferenca"] == 2.0

    # Stock shouldn't be updated yet on draft
    res_ins = client.get("/estoque/insumos", headers=headers)
    ins = next(i for i in res_ins.json() if i["id"] == "ins-carne")
    assert ins["estoque_atual"] == 10.0

    # Confirm count session
    res_conf = client.post(f"/estoque/contagens/{cont_data['id']}/confirmar", headers=headers)
    assert res_conf.status_code == 200
    assert res_conf.json()["status"] == "confirmada"

    # Stock should now be updated to 12.0kg
    res_ins_after = client.get("/estoque/insumos", headers=headers)
    ins_after = next(i for i in res_ins_after.json() if i["id"] == "ins-carne")
    assert ins_after["estoque_atual"] == 12.0

    # Check automatic movement of type "contagem" was generated
    res_mov = client.get("/estoque/movimentacoes?tipo=contagem", headers=headers)
    assert res_mov.status_code == 200
    assert len(res_mov.json()) == 1
    assert res_mov.json()[0]["quantidade"] == 2.0

# 7. Test duplicate count confirmation block
def test_bloqueio_confirmacao_duplicada_contagem():
    headers = get_auth_header()

    payload = {
        "observacao": "Inventário rápido",
        "status": "confirmada",
        "itens": [
            {
                "insumo_id": "ins-carne",
                "quantidade_contada": 8.0
            }
        ]
    }
    res = client.post("/estoque/contagens", json=payload, headers=headers)
    assert res.status_code == 201
    cont_id = res.json()["id"]

    # Attempt to confirm again
    res_dup = client.post(f"/estoque/contagens/{cont_id}/confirmar", headers=headers)
    assert res_dup.status_code == 400
    assert "já foi confirmada" in res_dup.json()["detail"]

# 8. Test multi-tenant isolation and absence of restaurante_id = 1
def test_isolamento_multi_tenant():
    headers_alfa = get_auth_header("alfa_op")
    headers_beta = get_auth_header("beta_op")

    # Alfa creates manual entry
    payload_alfa = {
        "numero_documento": "NF-ALFA",
        "itens": [{"insumo_id": "ins-carne", "quantidade": 5.0, "custo_unitario": 50.0}]
    }
    client.post("/estoque/entradas/manual", json=payload_alfa, headers=headers_alfa)

    # Alfa sees 1 entry, Beta sees 0 entries
    res_alfa = client.get("/estoque/entradas", headers=headers_alfa)
    res_beta = client.get("/estoque/entradas", headers=headers_beta)

    assert len(res_alfa.json()) == 1
    assert len(res_beta.json()) == 0
    assert res_alfa.json()[0]["numero_documento"] == "NF-ALFA"

    # Check Beta's stock for ins-carne-beta remained unchanged at 5.0kg
    res_beta_ins = client.get("/estoque/insumos", headers=headers_beta)
    ins_beta = next(i for i in res_beta_ins.json() if i["id"] == "ins-carne-beta")
    assert ins_beta["estoque_atual"] == 5.0
