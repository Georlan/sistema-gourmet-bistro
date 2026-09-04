"""
Testes para o subsistema de Satisfação do Cliente (CSAT / NPS Derivado).

Cobre:
A) nota 1 e 2 => insatisfeita
B) nota 3 => neutra
C) nota 4 e 5 => positiva
D) tenant isolation: restaurante 1 não enxerga avaliações do restaurante 2
E) identidade: avaliação vinculada por cliente_id, nunca telefone
F) POST rejeita cliente de outro tenant
G) se comanda_id usado:
   - rejeitar comanda de outro tenant
   - rejeitar comanda ligada a outro cliente
   - rejeitar comanda não concluída
   - rejeitar comanda já avaliada
H) resumo:
   notas 5, 4, 3, 2, 1
   total = 5, media = 3.0, positivas = 2, neutras = 1, insatisfeitas = 2
I) recentes ordenadas por criado_em desc
J) comentário inválido/grande rejeitado
K) integração com endpoints GET e POST /clientes/satisfacao
"""
import datetime
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db, current_restaurante_id
from app.main import app
from app.models import (
    AvaliacaoCliente,
    Cliente,
    Comanda,
    Mesa,
    Restaurante,
    Usuario,
)
from app.security import get_password_hash
from app.services.customer_satisfaction import (
    classify_satisfaction_rating,
    calculate_satisfaction_summary,
    get_recent_satisfaction_reviews,
    record_customer_satisfaction,
)

SQLALCHEMY_DATABASE_URL = "sqlite://"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
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
        Base.metadata.drop_all(bind=engine)
        Base.metadata.create_all(bind=engine)
        db = TestingSessionLocal()

        # Restaurante 1 (tenant principal)
        r1 = db.query(Restaurante).filter(Restaurante.id == 1).first()
        if not r1:
            r1 = Restaurante(id=1, nome="Bistrô Kôma")
            db.add(r1)

        # Restaurante 2 (tenant secundário)
        r2 = db.query(Restaurante).filter(Restaurante.id == 2).first()
        if not r2:
            r2 = Restaurante(id=2, nome="Pizzaria Bella")
            db.add(r2)

        # Usuários com permissão caixa (fidelidade:operar)
        db.add(
            Usuario(
                id="user-caixa-1",
                restaurante_id=1,
                nome="Operador Caixa R1",
                usuario="caixa_r1",
                senha_hash=get_password_hash("senha123"),
                role="caixa",
                status="ativo",
            )
        )
        db.add(
            Usuario(
                id="user-caixa-2",
                restaurante_id=2,
                nome="Operador Caixa R2",
                usuario="caixa_r2",
                senha_hash=get_password_hash("senha123"),
                role="caixa",
                status="ativo",
            )
        )

        db.add(Mesa(id=1, restaurante_id=1, capacidade=4))
        db.add(Mesa(id=2, restaurante_id=2, capacidade=4))

        db.commit()
        db.close()
        yield
    finally:
        current_restaurante_id.reset(token_var)


def get_auth_headers(client: TestClient, username: str, password: str = "senha123") -> dict:
    resp = client.post("/auth/login", json={"username": username, "password": password})
    assert resp.status_code == 200, resp.text
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


# ============================================================================
# A, B, C) CLASSIFICAÇÃO PURA
# ============================================================================

def test_classify_satisfaction_rating_boundaries():
    # A) nota 1 e 2 => insatisfeita
    assert classify_satisfaction_rating(1) == "insatisfeita"
    assert classify_satisfaction_rating(2) == "insatisfeita"

    # B) nota 3 => neutra
    assert classify_satisfaction_rating(3) == "neutra"

    # C) nota 4 e 5 => positiva
    assert classify_satisfaction_rating(4) == "positiva"
    assert classify_satisfaction_rating(5) == "positiva"

    # Fora do intervalo
    with pytest.raises(ValueError):
        classify_satisfaction_rating(0)
    with pytest.raises(ValueError):
        classify_satisfaction_rating(6)


# ============================================================================
# D) TENANT ISOLATION
# ============================================================================

def test_tenant_isolation_reviews_and_summary():
    db = TestingSessionLocal()

    # Cria cliente no R1
    c1 = Cliente(id="cli-r1", restaurante_id=1, nome="Cliente R1", telefone="11999990001")
    db.add(c1)
    db.commit()

    # Cria cliente no R2 com ContextVar do R2
    t2 = current_restaurante_id.set(2)
    try:
        c2 = Cliente(id="cli-r2", restaurante_id=2, nome="Cliente R2", telefone="11999990002")
        db.add(c2)
        db.commit()
    finally:
        current_restaurante_id.reset(t2)

    # Cria avaliações no R1
    record_customer_satisfaction(db, restaurante_id=1, cliente_id="cli-r1", nota=5, comentario="Ótimo R1")

    # Cria avaliações no R2 sob escopo R2
    t2 = current_restaurante_id.set(2)
    try:
        record_customer_satisfaction(db, restaurante_id=2, cliente_id="cli-r2", nota=1, comentario="Ruim R2")
        resumo_r2 = calculate_satisfaction_summary(db, restaurante_id=2)
        recentes_r2 = get_recent_satisfaction_reviews(db, restaurante_id=2)
    finally:
        current_restaurante_id.reset(t2)

    # Resumo R1
    resumo_r1 = calculate_satisfaction_summary(db, restaurante_id=1)
    assert resumo_r1["total_avaliacoes"] == 1
    assert resumo_r1["nota_media"] == 5.0
    assert resumo_r1["positivas"] == 1
    assert resumo_r1["insatisfeitas"] == 0

    # Resumo R2
    assert resumo_r2["total_avaliacoes"] == 1
    assert resumo_r2["nota_media"] == 1.0
    assert resumo_r2["positivas"] == 0
    assert resumo_r2["insatisfeitas"] == 1

    # Recentes R1
    recentes_r1 = get_recent_satisfaction_reviews(db, restaurante_id=1)
    assert len(recentes_r1) == 1
    assert recentes_r1[0]["cliente_nome"] == "Cliente R1"
    assert recentes_r1[0]["comentario"] == "Ótimo R1"

    # Recentes R2
    assert len(recentes_r2) == 1
    assert recentes_r2[0]["cliente_nome"] == "Cliente R2"
    assert recentes_r2[0]["comentario"] == "Ruim R2"

    db.close()


# ============================================================================
# E) IDENTIDADE CANÔNICA POR cliente_id (NUNCA TELEFONE)
# ============================================================================

def test_satisfaction_identity_strictly_by_cliente_id():
    db = TestingSessionLocal()

    # Dois clientes com telefones diferentes
    c1 = Cliente(id="cli-uuid-1", restaurante_id=1, nome="Maria Silva", telefone="11988880001")
    c2 = Cliente(id="cli-uuid-2", restaurante_id=1, nome="Maria Silva", telefone="11988880002")
    db.add_all([c1, c2])
    db.commit()

    # Avaliação registrada para c1
    av = record_customer_satisfaction(
        db, restaurante_id=1, cliente_id="cli-uuid-1", nota=4, comentario="Muito bom"
    )
    assert av["cliente_id"] == "cli-uuid-1"

    # Avaliação pertence somente a c1 no banco
    db_av = db.query(AvaliacaoCliente).filter(AvaliacaoCliente.id == av["id"]).first()
    assert db_av.cliente_id == "cli-uuid-1"
    assert db_av.cliente.telefone == "11988880001"

    # c2 não tem avaliações
    c2_db = db.query(Cliente).filter(Cliente.id == "cli-uuid-2").first()
    assert len(c2_db.avaliacoes) == 0

    db.close()


# ============================================================================
# F) POST REJEITA CLIENTE DE OUTRO TENANT
# ============================================================================

def test_post_rejects_client_from_another_tenant():
    client = TestClient(app)
    headers_r1 = get_auth_headers(client, "caixa_r1")

    db = TestingSessionLocal()
    t2 = current_restaurante_id.set(2)
    try:
        c2 = Cliente(id="cli-do-r2", restaurante_id=2, nome="Cliente do R2", telefone="21999990001")
        db.add(c2)
        db.commit()
    finally:
        current_restaurante_id.reset(t2)
    db.close()

    # R1 tenta registrar avaliação para cliente do R2
    resp = client.post(
        "/clientes/satisfacao",
        headers=headers_r1,
        json={
            "cliente_id": "cli-do-r2",
            "nota": 5,
            "comentario": "Excelente",
        },
    )
    assert resp.status_code == 404
    assert "Cliente não encontrado" in resp.json()["detail"]


# ============================================================================
# G) VALIDAÇÕES DE COMANDA
# ============================================================================

def test_comanda_validations_when_provided():
    client = TestClient(app)
    headers_r1 = get_auth_headers(client, "caixa_r1")

    db = TestingSessionLocal()
    # Clientes
    c1 = Cliente(id="cli-1", restaurante_id=1, nome="Ana", telefone="11911110001")
    c2 = Cliente(id="cli-2", restaurante_id=1, nome="Beto", telefone="11922220002")
    db.add_all([c1, c2])
    db.commit()

    # Comandas do R1
    cmd_beto = Comanda(id="cmd-beto", restaurante_id=1, numero_pedido=101, garcom_id="user-caixa-1", cliente_id="cli-2", fechada=True, valor_pago=80)
    cmd_ana_aberta = Comanda(id="cmd-ana-open", restaurante_id=1, numero_pedido=102, garcom_id="user-caixa-1", cliente_id="cli-1", fechada=False, valor_pago=0)
    cmd_ana_ok = Comanda(id="cmd-ana-closed", restaurante_id=1, numero_pedido=103, garcom_id="user-caixa-1", cliente_id="cli-1", fechada=True, valor_pago=120)
    db.add_all([cmd_beto, cmd_ana_aberta, cmd_ana_ok])
    db.commit()

    # Cliente e Comanda do R2 sob escopo R2
    t2 = current_restaurante_id.set(2)
    try:
        c_r2 = Cliente(id="cli-r2", restaurante_id=2, nome="Carlos", telefone="21933330003")
        db.add(c_r2)
        db.commit()
        cmd_r2 = Comanda(id="cmd-r2", restaurante_id=2, numero_pedido=201, garcom_id="user-caixa-2", cliente_id="cli-r2", fechada=True, valor_pago=50)
        db.add(cmd_r2)
        db.commit()
    finally:
        current_restaurante_id.reset(t2)

    db.close()

    # 1. Comanda de outro tenant
    resp1 = client.post(
        "/clientes/satisfacao",
        headers=headers_r1,
        json={"cliente_id": "cli-1", "nota": 5, "comanda_id": "cmd-r2"},
    )
    assert resp1.status_code == 404
    assert "Comanda não encontrada" in resp1.json()["detail"]

    # 2. Comanda ligada a outro cliente
    resp2 = client.post(
        "/clientes/satisfacao",
        headers=headers_r1,
        json={"cliente_id": "cli-1", "nota": 5, "comanda_id": "cmd-beto"},
    )
    assert resp2.status_code == 400
    assert "pertence a outro cliente" in resp2.json()["detail"]

    # 3. Comanda aberta / não concluída
    resp3 = client.post(
        "/clientes/satisfacao",
        headers=headers_r1,
        json={"cliente_id": "cli-1", "nota": 5, "comanda_id": "cmd-ana-open"},
    )
    assert resp3.status_code == 400
    assert "comandas concluídas" in resp3.json()["detail"]

    # 4. Comanda válida fecha com sucesso
    resp4 = client.post(
        "/clientes/satisfacao",
        headers=headers_r1,
        json={"cliente_id": "cli-1", "nota": 5, "comanda_id": "cmd-ana-closed", "comentario": "Perfeito"},
    )
    assert resp4.status_code == 201
    assert resp4.json()["nota"] == 5
    assert resp4.json()["comanda_id"] == "cmd-ana-closed"

    # 5. Mesma comanda avaliada novamente é rejeitada
    resp5 = client.post(
        "/clientes/satisfacao",
        headers=headers_r1,
        json={"cliente_id": "cli-1", "nota": 4, "comanda_id": "cmd-ana-closed"},
    )
    assert resp5.status_code == 400
    assert "já possui uma avaliação" in resp5.json()["detail"]


# ============================================================================
# H) RESUMO AGREGADO (5, 4, 3, 2, 1)
# ============================================================================

def test_satisfaction_summary_calculation():
    db = TestingSessionLocal()
    c = Cliente(id="cli-stats", restaurante_id=1, nome="Cliente Estatísticas", telefone="11977770001")
    db.add(c)
    db.commit()

    # Inserir notas: 5, 4, 3, 2, 1
    for nota in [5, 4, 3, 2, 1]:
        record_customer_satisfaction(db, restaurante_id=1, cliente_id="cli-stats", nota=nota)

    resumo = calculate_satisfaction_summary(db, restaurante_id=1)
    assert resumo["total_avaliacoes"] == 5
    assert resumo["nota_media"] == 3.0
    assert resumo["positivas"] == 2      # notas 4 e 5
    assert resumo["neutras"] == 1        # nota 3
    assert resumo["insatisfeitas"] == 2  # notas 1 e 2

    db.close()


# ============================================================================
# I) RECENTES ORDENADAS POR CRIADO_EM DESC
# ============================================================================

def test_recent_reviews_ordering():
    db = TestingSessionLocal()
    c = Cliente(id="cli-rec", restaurante_id=1, nome="Cliente Recentes", telefone="11966660001")
    db.add(c)
    db.commit()

    now = datetime.datetime.now(datetime.timezone.utc)
    # Avaliação 1: mais antiga
    av1 = AvaliacaoCliente(
        id="av-1",
        restaurante_id=1,
        cliente_id="cli-rec",
        nota=1,
        comentario="Antiga",
        criado_em=now - datetime.timedelta(days=2),
    )
    # Avaliação 2: média
    av2 = AvaliacaoCliente(
        id="av-2",
        restaurante_id=1,
        cliente_id="cli-rec",
        nota=3,
        comentario="Intermediária",
        criado_em=now - datetime.timedelta(days=1),
    )
    # Avaliação 3: mais recente
    av3 = AvaliacaoCliente(
        id="av-3",
        restaurante_id=1,
        cliente_id="cli-rec",
        nota=5,
        comentario="Recente",
        criado_em=now,
    )
    db.add_all([av1, av2, av3])
    db.commit()

    recentes = get_recent_satisfaction_reviews(db, restaurante_id=1, limit=10)
    assert len(recentes) == 3
    assert recentes[0]["id"] == "av-3"
    assert recentes[0]["comentario"] == "Recente"
    assert recentes[1]["id"] == "av-2"
    assert recentes[1]["comentario"] == "Intermediária"
    assert recentes[2]["id"] == "av-1"
    assert recentes[2]["comentario"] == "Antiga"

    db.close()


# ============================================================================
# J) COMENTÁRIO INVÁLIDO / GRANDE REJEITADO
# ============================================================================

def test_comment_length_validation():
    client = TestClient(app)
    headers = get_auth_headers(client, "caixa_r1")

    db = TestingSessionLocal()
    c = Cliente(id="cli-valid", restaurante_id=1, nome="Cliente Teste", telefone="11955550001")
    db.add(c)
    db.commit()
    db.close()

    # Comentário de 1001 caracteres (excede 1000)
    long_comment = "a" * 1001
    resp = client.post(
        "/clientes/satisfacao",
        headers=headers,
        json={"cliente_id": "cli-valid", "nota": 4, "comentario": long_comment},
    )
    assert resp.status_code in (400, 422)

    # Comentário de 1000 caracteres é aceito
    ok_comment = "a" * 1000
    resp_ok = client.post(
        "/clientes/satisfacao",
        headers=headers,
        json={"cliente_id": "cli-valid", "nota": 4, "comentario": ok_comment},
    )
    assert resp_ok.status_code == 201
    assert resp_ok.json()["nota"] == 4


# ============================================================================
# K) INTEGRAÇÃO COMPLETA ENDPOINT GET /clientes/satisfacao
# ============================================================================

def test_get_satisfaction_endpoint_full_flow():
    client = TestClient(app)
    headers = get_auth_headers(client, "caixa_r1")

    # 1. Sem avaliações inicialmente
    resp = client.get("/clientes/satisfacao", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["resumo"]["total_avaliacoes"] == 0
    assert data["resumo"]["nota_media"] is None
    assert data["resumo"]["positivas"] == 0
    assert data["resumo"]["neutras"] == 0
    assert data["resumo"]["insatisfeitas"] == 0
    assert data["recentes"] == []

    # 2. Registra cliente e avaliação
    db = TestingSessionLocal()
    c = Cliente(id="cli-get-flow", restaurante_id=1, nome="Beatriz", telefone="11944440001")
    db.add(c)
    db.commit()
    db.close()

    post_resp = client.post(
        "/clientes/satisfacao",
        headers=headers,
        json={"cliente_id": "cli-get-flow", "nota": 5, "comentario": "Adorei a comida!"},
    )
    assert post_resp.status_code == 201

    # 3. Consulta novamente
    resp2 = client.get("/clientes/satisfacao", headers=headers)
    assert resp2.status_code == 200
    data2 = resp2.json()
    assert data2["resumo"]["total_avaliacoes"] == 1
    assert data2["resumo"]["nota_media"] == 5.0
    assert data2["resumo"]["positivas"] == 1
    assert len(data2["recentes"]) == 1
    assert data2["recentes"][0]["cliente_nome"] == "Beatriz"
    assert data2["recentes"][0]["nota"] == 5
    assert data2["recentes"][0]["classificacao"] == "positiva"
    assert data2["recentes"][0]["comentario"] == "Adorei a comida!"
