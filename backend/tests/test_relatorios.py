import os
import datetime
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db, current_restaurante_id
from app.models import (
    Usuario, Produto, Categoria, Comanda, Item,
    ConfiguracaoRestaurante, Lancamento, Restaurante
)
from app.security import get_password_hash
from app.main import app

DB_FILE = "./test_relatorios_v2.db"
SQLALCHEMY_DATABASE_URL = f"sqlite:///{DB_FILE}"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False, "timeout": 30}
)
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
        # Drop + recreate each time for isolation
        Base.metadata.drop_all(bind=engine)
        Base.metadata.create_all(bind=engine)
        db = TestingSessionLocal()

        # --- Restaurantes (use merge to handle autoincrement PK) ---
        db.merge(Restaurante(id=1, nome="Bistro Test", plano="bistro"))
        db.merge(Restaurante(id=2, nome="Outro Restaurante", plano="pocket"))
        db.flush()

        # --- Usuários (tenant 1) ---
        db.add(Usuario(
            id="u-admin", restaurante_id=1, nome="Admin Test",
            usuario="admin", senha_hash=get_password_hash("123"),
            role="admin", cargo="admin"
        ))
        db.add(Usuario(
            id="u-garcom", restaurante_id=1, nome="Garcom Test",
            usuario="garcom", senha_hash=get_password_hash("123"),
            role="garcom", cargo="garcom"
        ))
        db.add(Usuario(
            id="u-caixa", restaurante_id=1, nome="Caixa Test",
            usuario="caixa", senha_hash=get_password_hash("123"),
            role="caixa", cargo="caixa"
        ))
        # Tenant 2 — deve ser completamente isolado
        db.add(Usuario(
            id="u-t2", restaurante_id=2, nome="Outro Tenant",
            usuario="outro", senha_hash=get_password_hash("123"),
            role="garcom", cargo="garcom"
        ))

        # --- Produto e Categoria ---
        cat = Categoria(id=1, restaurante_id=1, nome="Lanches")
        db.add(cat)
        db.add(Produto(id="p-1", restaurante_id=1, nome="X-Salada", categoria_id=1, preco=25.0, ativo=True))

        db.add(ConfiguracaoRestaurante(
            restaurante_id=1, meta_mensal=5000.0,
            taxa_servico_padrao=10.0, taxa_servico_ativa=True
        ))
        db.flush()

        # --- Comanda fechada há 15 dias (DENTRO do período de 30 dias) ---
        now = datetime.datetime.now()
        past15 = now - datetime.timedelta(days=15)

        c1 = Comanda(
            id="cmd-1", restaurante_id=1, garcom_id="u-garcom",
            fechada=True, fechado_em=past15, criado_em=past15,
            mesa_id=None, numero_pedido=1
        )
        db.add(c1)
        db.flush()

        lan1 = Lancamento(id="lan-1", comanda_id="cmd-1", garcom_id="u-garcom", timestamp=past15)
        db.add(lan1)
        db.flush()

        # 2 itens de R$ 25 cada → faturamento = 50.0
        db.add(Item(id="item-1a", comanda_id="cmd-1", lancamento_id="lan-1",
                    produto_id="p-1", preco_unit=25.0, status="entregue", restaurante_id=1))
        db.add(Item(id="item-1b", comanda_id="cmd-1", lancamento_id="lan-1",
                    produto_id="p-1", preco_unit=25.0, status="entregue", restaurante_id=1))

        # --- Comanda FORA do período (90 dias atrás) ---
        past90 = now - datetime.timedelta(days=90)
        c2 = Comanda(
            id="cmd-old", restaurante_id=1, garcom_id="u-garcom",
            fechada=True, fechado_em=past90, criado_em=past90,
            mesa_id=None, numero_pedido=2
        )
        db.add(c2)
        db.flush()

        lan2 = Lancamento(id="lan-2", comanda_id="cmd-old", garcom_id="u-garcom", timestamp=past90)
        db.add(lan2)
        db.flush()

        db.add(Item(id="item-old", comanda_id="cmd-old", lancamento_id="lan-2",
                    produto_id="p-1", preco_unit=25.0, status="entregue", restaurante_id=1))

        db.commit()
        db.close()
        yield
    finally:
        current_restaurante_id.reset(token_var)
        # Remove DB file for next test run
        import os
        try:
            engine.dispose()
            os.remove(DB_FILE)
        except Exception:
            pass


def get_auth_headers(client, username, password):
    resp = client.post("/auth/login", json={"username": username, "password": password})
    assert resp.status_code == 200, f"Login falhou para '{username}': {resp.text}"
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


# ---------------------------------------------------------------------------
# Suite original (compatibilidade)
# ---------------------------------------------------------------------------

def test_relatorios_full_suite():
    client = TestClient(app)
    headers = get_auth_headers(client, "admin", "123")

    resp = client.post("/relatorios/meta-mensal", json={"meta_mensal": 10000.0}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["meta_mensal"] == 10000.0

    resp = client.get("/relatorios/visao-geral", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    for key in ("faturamento_total", "total_pedidos", "ticket_medio", "meta_mensal", "vendas_por_dia", "horarios_pico"):
        assert key in data, f"Campo '{key}' ausente em visao-geral"
    assert data["meta_mensal"] == 10000.0

    resp = client.get("/relatorios/vendas-detalhes", headers=headers)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)

    resp = client.get("/relatorios/produtos?ordenacao=mais_vendidos", headers=headers)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)

    # Desempenho padrão — sem motoboy, sem admin
    resp = client.get("/relatorios/equipe/desempenho", headers=headers)
    assert resp.status_code == 200
    res = resp.json()
    assert "membros" in res
    assert "taxa_servico_padrao" in res
    roles = {m["role"] for m in res["membros"]}
    assert "admin"   not in roles, "admin não deve aparecer no ranking padrão"
    assert "motoboy" not in roles, "motoboy não deve aparecer no plano Bistrô"
    assert "garcom"  in roles,     "garcom deve aparecer"
    assert "caixa"   in roles,     "caixa deve aparecer"


# ---------------------------------------------------------------------------
# Filtro por cargo
# ---------------------------------------------------------------------------

def test_equipe_desempenho_cargo_filter():
    client = TestClient(app)
    headers = get_auth_headers(client, "admin", "123")

    for cargo in ("garcom", "caixa"):
        resp = client.get(f"/relatorios/equipe/desempenho?cargo={cargo}", headers=headers)
        assert resp.status_code == 200, f"HTTP {resp.status_code} para cargo={cargo}"
        membros = resp.json()["membros"]
        assert membros, f"Nenhum resultado para cargo={cargo}"
        assert all(m["role"] == cargo for m in membros), f"Membros incorretos para cargo={cargo}"

    resp = client.get("/relatorios/equipe/desempenho?cargo=todos", headers=headers)
    assert resp.status_code == 200
    # cargo=todos should return ALL 3 users of tenant 1 (garcom, caixa, admin)
    membros_todos = resp.json()["membros"]
    assert len(membros_todos) == 3, \
        f"cargo=todos deve retornar 3 membros do tenant 1, obteve {len(membros_todos)}"
    ids_todos = {m["id"] for m in membros_todos}
    assert "u-admin" in ids_todos, "u-admin deve aparecer com cargo=todos"


# ---------------------------------------------------------------------------
# Filtro por período
# ---------------------------------------------------------------------------

def test_equipe_desempenho_periodo():
    client = TestClient(app)
    headers = get_auth_headers(client, "admin", "123")

    now = datetime.datetime.now()
    inicio = (now - datetime.timedelta(days=30)).strftime("%Y-%m-%d")
    fim    = now.strftime("%Y-%m-%d")

    resp = client.get(
        f"/relatorios/equipe/desempenho?cargo=garcom&data_inicio={inicio}&data_fim={fim}",
        headers=headers
    )
    assert resp.status_code == 200
    membros = resp.json()["membros"]
    garcom = next((m for m in membros if m["role"] == "garcom"), None)
    assert garcom is not None, "Garçom deve aparecer no resultado"

    # cmd-1 (15 dias) está dentro; cmd-old (90 dias) está fora
    assert garcom["pedidos_atendidos"] == 1, \
        f"Esperado 1 pedido no período de 30d, obteve {garcom['pedidos_atendidos']}"
    # 2 itens × R$ 25 = R$ 50
    assert garcom["faturamento"] == 50.0, \
        f"Esperado R$ 50.00, obteve {garcom['faturamento']}"


# ---------------------------------------------------------------------------
# Comissão proporcional
# ---------------------------------------------------------------------------

def test_equipe_desempenho_comissao_proporcional():
    client = TestClient(app)
    headers = get_auth_headers(client, "admin", "123")

    now = datetime.datetime.now()
    inicio = (now - datetime.timedelta(days=30)).strftime("%Y-%m-%d")
    fim    = now.strftime("%Y-%m-%d")

    resp = client.get(
        f"/relatorios/equipe/desempenho?cargo=garcom&data_inicio={inicio}&data_fim={fim}",
        headers=headers
    )
    assert resp.status_code == 200
    garcom = next((m for m in resp.json()["membros"] if m["role"] == "garcom"), None)
    assert garcom is not None

    expected = round(garcom["faturamento"] * 0.10, 2)
    assert garcom["comissao"] == expected, \
        f"Comissão esperada {expected} (10% de {garcom['faturamento']}), obtida {garcom['comissao']}"


# ---------------------------------------------------------------------------
# Zero vendas
# ---------------------------------------------------------------------------

def test_equipe_desempenho_zero_vendas():
    client = TestClient(app)
    headers = get_auth_headers(client, "admin", "123")

    resp = client.get("/relatorios/equipe/desempenho?cargo=caixa", headers=headers)
    assert resp.status_code == 200
    membros = resp.json()["membros"]
    assert len(membros) == 1, f"Esperado exatamente 1 caixa, obteve {len(membros)}"
    caixa = membros[0]
    assert caixa["pedidos_atendidos"] == 0
    assert caixa["faturamento"] == 0.0
    assert caixa["comissao"] == 0.0


# ---------------------------------------------------------------------------
# Isolamento por tenant
# ---------------------------------------------------------------------------

def test_equipe_desempenho_tenant_isolation():
    client = TestClient(app)
    headers = get_auth_headers(client, "admin", "123")

    resp = client.get("/relatorios/equipe/desempenho?cargo=todos", headers=headers)
    assert resp.status_code == 200
    ids = {m["id"] for m in resp.json()["membros"]}
    assert "u-t2" not in ids, "Usuário do tenant 2 não deve aparecer nos resultados do tenant 1"


# ---------------------------------------------------------------------------
# Endpoint cargos-permissoes (dados reais da API — sem mock nem motoboy)
# ---------------------------------------------------------------------------

def test_cargos_permissoes_endpoint():
    client = TestClient(app)
    headers = get_auth_headers(client, "admin", "123")

    resp = client.get("/relatorios/cargos-permissoes", headers=headers)
    assert resp.status_code == 200, f"Falha no endpoint: {resp.text}"
    data = resp.json()
    assert "cargos" in data, "Resposta deve conter 'cargos'"

    cargos = {c["slug"]: c for c in data["cargos"]}

    # Cargos cadastrados no tenant 1 devem aparecer
    for slug in ("garcom", "caixa", "admin"):
        assert slug in cargos, f"Cargo '{slug}' deve estar na lista"

    # Contagem real de funcionários (1 de cada no setup)
    assert cargos["garcom"]["total_funcionarios"] == 1
    assert cargos["caixa"]["total_funcionarios"]  == 1
    assert cargos["admin"]["total_funcionarios"]  == 1

    # Permissões do admin
    p_admin = cargos["admin"]["permissoes"]
    assert p_admin["pedidos"]    is True
    assert p_admin["relatorios"] is True
    assert p_admin["admin"]      is True

    # Permissões do garçom
    p_garcom = cargos["garcom"]["permissoes"]
    assert p_garcom["pedidos"]    is True
    assert p_garcom["caixa"]      is False
    assert p_garcom["relatorios"] is False

    # Motoboy NÃO deve aparecer (plano Bistrô, sem delivery)
    assert "motoboy" not in cargos, "motoboy não deve aparecer no plano Bistrô"
