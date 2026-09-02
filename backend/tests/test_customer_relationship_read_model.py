"""Testes para o read model de relacionamento de clientes (Cliente + Comanda fechada)."""

import datetime
from decimal import Decimal
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db, current_restaurante_id
from app.main import app
from app.models import (
    Cliente,
    Comanda,
    Mesa,
    Restaurante,
    Usuario,
)
from app.security import get_password_hash
from app.services.customer_relationship import (
    CustomerRelationshipMetrics,
    build_customer_relationship_payloads,
    classify_customer_relationship,
    load_customer_relationship_metrics,
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

        # Restaurante 2 (tenant isolado)
        r2 = db.query(Restaurante).filter(Restaurante.id == 2).first()
        if not r2:
            r2 = Restaurante(id=2, nome="Outro Restaurante")
            db.add(r2)

        # Usuários
        db.add(
            Usuario(
                id="user-caixa-1",
                restaurante_id=1,
                nome="Operador Caixa",
                usuario="caixa_r1",
                senha_hash=get_password_hash("senha123"),
                role="caixa",
                status="ativo",
            )
        )
        db.add(
            Usuario(
                id="user-garcom-1",
                restaurante_id=1,
                nome="Garçom 1",
                usuario="garcom_r1",
                senha_hash=get_password_hash("senha123"),
                role="garcom",
                status="ativo",
            )
        )
        db.add(
            Usuario(
                id="user-caixa-2",
                restaurante_id=2,
                nome="Caixa R2",
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
# A) CLASSIFICAÇÃO PURA
# ============================================================================

def test_classify_customer_relationship_pure():
    """A) Classificação com base nos dias sem comprar."""
    # Sem compra (None)
    assert classify_customer_relationship(None) == "SEM_COMPRA"

    # Até 30 dias inclusive -> ATIVO
    assert classify_customer_relationship(0) == "ATIVO"
    assert classify_customer_relationship(1) == "ATIVO"
    assert classify_customer_relationship(15) == "ATIVO"
    assert classify_customer_relationship(30) == "ATIVO"

    # 31 a 60 dias inclusive -> ATENCAO
    assert classify_customer_relationship(31) == "ATENCAO"
    assert classify_customer_relationship(45) == "ATENCAO"
    assert classify_customer_relationship(60) == "ATENCAO"

    # Mais de 60 dias -> REATIVAR
    assert classify_customer_relationship(61) == "REATIVAR"
    assert classify_customer_relationship(90) == "REATIVAR"
    assert classify_customer_relationship(365) == "REATIVAR"


# ============================================================================
# B) ISOLAMENTO MULTITENANT
# ============================================================================

def test_multitenant_relationship_isolation():
    """B) Métricas de um tenant nunca vazam para outro tenant."""
    db = TestingSessionLocal()
    now_fixed = datetime.datetime(2026, 9, 2, 12, 0, 0, tzinfo=datetime.timezone.utc)

    # Cliente no Restaurante 1
    c1 = Cliente(
        id="c-r1-001",
        restaurante_id=1,
        nome="Cliente R1",
        telefone="85999990001",
        saldo_pontos=10,
        saldo_cashback=5.0,
    )
    db.add(c1)

    # Cliente no Restaurante 2
    c2 = Cliente(
        id="c-r2-001",
        restaurante_id=2,
        nome="Cliente R2",
        telefone="85999990002",
        saldo_pontos=50,
        saldo_cashback=20.0,
    )
    db.add(c2)
    db.commit()

    # Comanda fechada R1 (R$ 100)
    db.add(
        Comanda(
            id="com-r1-1",
            restaurante_id=1,
            cliente_id="c-r1-001",
            garcom_id="user-garcom-1",
            numero_pedido=101,
            fechada=True,
            fechado_em=now_fixed - datetime.timedelta(days=10),
            valor_pago=100.0,
        )
    )

    # Comanda fechada R2 (R$ 500)
    db.add(
        Comanda(
            id="com-r2-1",
            restaurante_id=2,
            cliente_id="c-r2-001",
            garcom_id="user-caixa-2",
            numero_pedido=201,
            fechada=True,
            fechado_em=now_fixed - datetime.timedelta(days=5),
            valor_pago=500.0,
        )
    )
    db.commit()

    # Carregar métricas no Restaurante 1
    metrics_r1 = load_customer_relationship_metrics(
        db,
        restaurante_id=1,
        cliente_ids=["c-r1-001", "c-r2-001"],
        now=now_fixed,
    )

    # c-r1-001 tem 1 pedido de R$ 100
    assert metrics_r1["c-r1-001"].pedidos_concluidos == 1
    assert metrics_r1["c-r1-001"].valor_pago_total == 100.0
    assert metrics_r1["c-r1-001"].ticket_medio_pago == 100.0
    assert metrics_r1["c-r1-001"].dias_sem_comprar == 10
    assert metrics_r1["c-r1-001"].segmento_relacionamento == "ATIVO"

    # c-r2-001 consultado no contexto do R1 NÃO deve enxergar comandas do R2
    assert metrics_r1["c-r2-001"].pedidos_concluidos == 0
    assert metrics_r1["c-r2-001"].valor_pago_total == 0.0
    assert metrics_r1["c-r2-001"].ticket_medio_pago == 0.0
    assert metrics_r1["c-r2-001"].dias_sem_comprar is None
    assert metrics_r1["c-r2-001"].segmento_relacionamento == "SEM_COMPRA"

    db.close()


# ============================================================================
# C) IDENTIDADE EXCLUSIVA POR CLIENTE_ID
# ============================================================================

def test_identity_exclusively_by_cliente_id():
    """C) Vínculo exclusivamente por cliente_id, sem heurística por telefone ou nome."""
    db = TestingSessionLocal()
    now_fixed = datetime.datetime(2026, 9, 2, 12, 0, 0, tzinfo=datetime.timezone.utc)

    # Cliente A
    cA = Cliente(
        id="c-id-alpha",
        restaurante_id=1,
        nome="Maria Silva",
        telefone="85988881111",
    )
    # Cliente B com nome idêntico
    cB = Cliente(
        id="c-id-beta",
        restaurante_id=1,
        nome="Maria Silva",
        telefone="85988882222",
    )
    db.add_all([cA, cB])
    db.commit()

    # Comanda fechada associada a cA
    db.add(
        Comanda(
            id="com-alpha-1",
            restaurante_id=1,
            cliente_id="c-id-alpha",
            garcom_id="user-garcom-1",
            numero_pedido=102,
            fechada=True,
            fechado_em=now_fixed - datetime.timedelta(days=5),
            valor_pago=80.0,
        )
    )
    db.commit()

    metrics = load_customer_relationship_metrics(
        db,
        restaurante_id=1,
        cliente_ids=["c-id-alpha", "c-id-beta"],
        now=now_fixed,
    )

    assert metrics["c-id-alpha"].pedidos_concluidos == 1
    assert metrics["c-id-alpha"].valor_pago_total == 80.0
    assert metrics["c-id-alpha"].segmento_relacionamento == "ATIVO"

    assert metrics["c-id-beta"].pedidos_concluidos == 0
    assert metrics["c-id-beta"].valor_pago_total == 0.0
    assert metrics["c-id-beta"].segmento_relacionamento == "SEM_COMPRA"

    db.close()


# ============================================================================
# D) APENAS COMANDAS FECHADAS CONTAM
# ============================================================================

def test_only_closed_comandas_are_counted():
    """D) Comandas abertas (fechada == False) não contam como compras concluídas."""
    db = TestingSessionLocal()
    now_fixed = datetime.datetime(2026, 9, 2, 12, 0, 0, tzinfo=datetime.timezone.utc)

    c = Cliente(
        id="c-id-open-test",
        restaurante_id=1,
        nome="João Teste",
        telefone="85977773333",
    )
    db.add(c)
    db.commit()

    # Comanda ABERTA de R$ 200
    db.add(
        Comanda(
            id="com-open-1",
            restaurante_id=1,
            cliente_id="c-id-open-test",
            garcom_id="user-garcom-1",
            numero_pedido=103,
            fechada=False,
            criado_em=now_fixed - datetime.timedelta(hours=2),
            valor_pago=200.0,
        )
    )
    db.commit()

    metrics = load_customer_relationship_metrics(
        db,
        restaurante_id=1,
        cliente_ids=["c-id-open-test"],
        now=now_fixed,
    )

    assert metrics["c-id-open-test"].pedidos_concluidos == 0
    assert metrics["c-id-open-test"].valor_pago_total == 0.0
    assert metrics["c-id-open-test"].ticket_medio_pago == 0.0
    assert metrics["c-id-open-test"].dias_sem_comprar is None
    assert metrics["c-id-open-test"].segmento_relacionamento == "SEM_COMPRA"

    db.close()


# ============================================================================
# E) CÁLCULO DE VALOR TOTAL E TICKET MÉDIO
# ============================================================================

def test_calculation_total_and_average_ticket():
    """E) 2 comandas fechadas de R$ 40 e R$ 60 -> concluidos=2, total=100.00, ticket=50.00."""
    db = TestingSessionLocal()
    now_fixed = datetime.datetime(2026, 9, 2, 12, 0, 0, tzinfo=datetime.timezone.utc)

    c = Cliente(
        id="c-id-calc-test",
        restaurante_id=1,
        nome="Carlos Pagador",
        telefone="85966664444",
    )
    db.add(c)
    db.commit()

    # Comanda 1: R$ 40, fechada há 40 dias
    db.add(
        Comanda(
            id="com-calc-1",
            restaurante_id=1,
            cliente_id="c-id-calc-test",
            garcom_id="user-garcom-1",
            numero_pedido=104,
            fechada=True,
            fechado_em=now_fixed - datetime.timedelta(days=40),
            valor_pago=40.0,
        )
    )
    # Comanda 2: R$ 60, fechada há 35 dias
    db.add(
        Comanda(
            id="com-calc-2",
            restaurante_id=1,
            cliente_id="c-id-calc-test",
            garcom_id="user-garcom-1",
            numero_pedido=105,
            fechada=True,
            fechado_em=now_fixed - datetime.timedelta(days=35),
            valor_pago=60.0,
        )
    )
    db.commit()

    metrics = load_customer_relationship_metrics(
        db,
        restaurante_id=1,
        cliente_ids=["c-id-calc-test"],
        now=now_fixed,
    )

    m = metrics["c-id-calc-test"]
    assert m.pedidos_concluidos == 2
    assert m.valor_pago_total == 100.00
    assert m.ticket_medio_pago == 50.00
    assert m.dias_sem_comprar == 35
    assert m.segmento_relacionamento == "ATENCAO"

    db.close()


# ============================================================================
# F) REGISTRO LEGADO (CRIADO_EM COMO FALLBACK)
# ============================================================================

def test_legacy_record_fallback_to_criado_em():
    """F) Comanda fechada sem fechado_em deve usar criado_em como última compra."""
    db = TestingSessionLocal()
    now_fixed = datetime.datetime(2026, 9, 2, 12, 0, 0, tzinfo=datetime.timezone.utc)

    c = Cliente(
        id="c-id-legacy-test",
        restaurante_id=1,
        nome="Antônio Legado",
        telefone="85955555555",
    )
    db.add(c)
    db.commit()

    # Comanda fechada sem fechado_em, criado_em há 70 dias
    criado_dt = now_fixed - datetime.timedelta(days=70)
    db.add(
        Comanda(
            id="com-legacy-1",
            restaurante_id=1,
            cliente_id="c-id-legacy-test",
            garcom_id="user-garcom-1",
            numero_pedido=106,
            fechada=True,
            fechado_em=None,
            criado_em=criado_dt,
            valor_pago=45.0,
        )
    )
    db.commit()

    metrics = load_customer_relationship_metrics(
        db,
        restaurante_id=1,
        cliente_ids=["c-id-legacy-test"],
        now=now_fixed,
    )

    m = metrics["c-id-legacy-test"]
    assert m.pedidos_concluidos == 1
    assert m.valor_pago_total == 45.0
    assert m.dias_sem_comprar == 70
    assert m.segmento_relacionamento == "REATIVAR"
    assert m.ultima_compra_em is not None

    db.close()


# ============================================================================
# G) ENDPOINT GET /fidelidade/clientes (INTEGRAÇÃO E CONTRATO)
# ============================================================================

def test_endpoint_get_loyalty_clients_additive_contract():
    """G) O endpoint GET /fidelidade/clientes preserva campos e adiciona métricas de relacionamento."""
    client = TestClient(app)
    headers = get_auth_headers(client, "caixa_r1")
    db = TestingSessionLocal()

    c = Cliente(
        id="c-endpoint-test-1",
        restaurante_id=1,
        nome="Ana Cliente",
        telefone="85944446666",
        endereco="Rua Central, 123",
        saldo_pontos=150,
        saldo_cashback=12.50,
    )
    db.add(c)
    db.commit()

    # Adicionar comanda fechada
    db.add(
        Comanda(
            id="com-endpoint-1",
            restaurante_id=1,
            cliente_id="c-endpoint-test-1",
            garcom_id="user-garcom-1",
            numero_pedido=107,
            fechada=True,
            fechado_em=datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=2),
            valor_pago=90.0,
        )
    )
    db.commit()
    db.close()

    resp = client.get("/fidelidade/clientes", headers=headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) >= 1

    item = next(x for x in data if x["id"] == "c-endpoint-test-1")
    # Campos canônicos preexistentes preservados
    assert item["id"] == "c-endpoint-test-1"
    assert item["cliente"] == "Ana Cliente"
    assert item["nome"] == "Ana Cliente"
    assert item["telefone"] == "85944446666"
    assert item["endereco"] == "Rua Central, 123"
    assert item["pontos"] == 150
    assert item["saldo_pontos"] == 150
    assert item["saldoCashback"] == 12.50
    assert item["saldo_cashback"] == 12.50

    # Campos aditivos de relacionamento
    assert item["pedidos_concluidos"] == 1
    assert item["valor_pago_total"] == 90.0
    assert item["ticket_medio_pago"] == 90.0
    assert item["dias_sem_comprar"] == 2
    assert item["segmento_relacionamento"] == "ATIVO"
    assert item["ultima_compra_em"] is not None
