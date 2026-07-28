"""
Tests for print agent authentication, atomic claiming, anti-duplication, and stuck job recovery.
"""
import pytest
import datetime
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db, current_restaurante_id
from app.models import Restaurante, Usuario, PrintAgentToken, PrintJob
from app.routes.print_agents import hash_token
from app.security import create_access_token
from app.main import app

DB_FILE = "./test_print_agents.db"
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
        Base.metadata.drop_all(bind=engine)
        Base.metadata.create_all(bind=engine)
        db = TestingSessionLocal()

        db.merge(Restaurante(id=1, nome="Print Test Bistro", plano="bistro"))
        db.merge(Restaurante(id=2, nome="Print Test Bistro 2", plano="bistro"))
        db.flush()

        db.add(Usuario(
            id="2",
            restaurante_id=2,
            nome="Admin Restaurante 2",
            email="admin2@teste.local",
            cargo="admin",
            status="ativo",
        ))
        db.add(Usuario(
            id="garcom-2",
            restaurante_id=2,
            nome="Garçom Restaurante 2",
            email="garcom2@teste.local",
            cargo="garcom",
            status="ativo",
        ))

        # Agente 1 e Agente 2
        t1 = hash_token("token_agent_1")
        t2 = hash_token("token_agent_2")
        db.add(PrintAgentToken(id="a1", restaurante_id=1, agent_id="agent-box-1", token_hash=t1, ativo=True))
        db.add(PrintAgentToken(id="a2", restaurante_id=1, agent_id="agent-box-2", token_hash=t2, ativo=True))

        # Print Job pendente
        db.add(PrintJob(
            id="job-1001",
            restaurante_id=1,
            document_type="ticket_cozinha",
            destination="COZINHA",
            source_type="comanda",
            source_id="cmd-1",
            payload_text="1x X-Salada",
            status="pending",
            idempotency_key="idemp:1001"
        ))
        db.add(PrintJob(
            id="job-2001",
            restaurante_id=2,
            document_type="ticket_cozinha",
            destination="COZINHA",
            source_type="comanda",
            source_id="cmd-2",
            payload_text="1x Pedido tenant 2",
            status="pending",
            idempotency_key="idemp:2001"
        ))

        db.commit()
        db.close()
        yield
    finally:
        current_restaurante_id.reset(token_var)
        import os
        try:
            engine.dispose()
            os.remove(DB_FILE)
        except Exception:
            pass


def jwt_headers(user_id: str, restaurante_id: int, role: str) -> dict[str, str]:
    token = create_access_token(
        subject=user_id,
        restaurante_id=restaurante_id,
        role=role,
    )
    return {"Authorization": f"Bearer {token}"}


def test_atomic_claim_job_success():
    """Agente 1 faz o claim com sucesso."""
    client = TestClient(app)
    headers = {"X-Agent-Token": "token_agent_1"}

    resp = client.post("/api/print-agents/jobs/job-1001/claim", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["id"] == "job-1001"


def test_concurrent_claim_second_agent_gets_conflict():
    """Agente 2 tentando o claim do mesmo job já assumido deve receber HTTP 409 Conflict."""
    client = TestClient(app)
    headers1 = {"X-Agent-Token": "token_agent_1"}
    headers2 = {"X-Agent-Token": "token_agent_2"}

    # Agente 1 assume o job
    resp1 = client.post("/api/print-agents/jobs/job-1001/claim", headers=headers1)
    assert resp1.status_code == 200

    # Agente 2 tenta assumir o mesmo job
    resp2 = client.post("/api/print-agents/jobs/job-1001/claim", headers=headers2)
    assert resp2.status_code == 409, f"Esperado 409 Conflict, obteve {resp2.status_code}"
    assert "já foi assumido" in resp2.json()["detail"]


def test_claim_next_reserves_job_in_one_request():
    """Busca e claim acontecem juntos, com telemetria da fila."""
    client = TestClient(app)
    headers = {"X-Agent-Token": "token_agent_1"}

    response = client.post(
        "/api/print-agents/jobs/claim-next",
        headers=headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == "job-1001"
    assert payload["queue_latency_ms"] >= 0
    assert payload["claimed_at"]

    db = TestingSessionLocal()
    try:
        job = db.query(PrintJob).filter_by(id="job-1001").one()
        assert job.status == "claimed"
        assert job.agent_id == "agent-box-1"
    finally:
        db.close()


def test_claim_next_never_delivers_same_job_to_second_agent():
    """O segundo agente não recebe o job já reservado atomicamente."""
    client = TestClient(app)
    headers1 = {"X-Agent-Token": "token_agent_1"}
    headers2 = {"X-Agent-Token": "token_agent_2"}

    first = client.post(
        "/api/print-agents/jobs/claim-next",
        headers=headers1,
    )
    second = client.post(
        "/api/print-agents/jobs/claim-next",
        headers=headers2,
    )

    assert first.status_code == 200
    assert first.json()["id"] == "job-1001"
    assert second.status_code == 200
    assert second.json() is None


def test_stuck_job_recovery():
    """Jobs em 'claimed' há mais de 5min são liberados automaticamente no /jobs/next."""
    db = TestingSessionLocal()
    stuck_time = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=10)
    db.add(PrintJob(
        id="job-stuck-999",
        restaurante_id=1,
        document_type="ticket_caixa",
        destination="FECHAMENTO",
        source_type="comanda",
        source_id="cmd-2",
        payload_text="1x Coca-Cola",
        status="claimed",
        claimed_at=stuck_time,
        agent_id="agent-dead",
        idempotency_key="idemp:stuck999"
    ))
    db.commit()
    db.close()

    client = TestClient(app)
    headers = {"X-Agent-Token": "token_agent_1"}

    resp = client.get("/api/print-agents/jobs/next", headers=headers)
    assert resp.status_code == 200
    # O job travado deve ter sido liberado para 'pending' e retornado
    next_job = resp.json()
    assert next_job is not None


def test_only_heartbeat_updates_agent_last_seen():
    """Polling ocioso não grava no banco; heartbeat registra presença do agente."""
    client = TestClient(app)
    headers = {"X-Agent-Token": "token_agent_1"}

    next_response = client.get("/api/print-agents/jobs/next", headers=headers)
    assert next_response.status_code == 200

    db = TestingSessionLocal()
    try:
        agent = db.query(PrintAgentToken).filter_by(id="a1").one()
        assert agent.last_seen_at is None
    finally:
        db.close()

    heartbeat_response = client.post(
        "/api/print-agents/heartbeat",
        headers=headers,
    )
    assert heartbeat_response.status_code == 200

    db = TestingSessionLocal()
    try:
        agent = db.query(PrintAgentToken).filter_by(id="a1").one()
        assert agent.last_seen_at is not None
    finally:
        db.close()


@pytest.mark.parametrize(
    ("path", "payload"),
    [
        (
            "/api/print-agents/jobs/inject",
            {"payload_text": "teste sem permissão"},
        ),
        (
            "/api/print-agents/register",
            {"agent_id": "agent-sem-permissao"},
        ),
        (
            "/api/print-agents/jobs/job-2001/reprint",
            None,
        ),
    ],
)
def test_admin_print_routes_reject_garcom(path, payload):
    client = TestClient(app)
    headers = jwt_headers("garcom-2", 2, "garcom")

    response = client.post(path, headers=headers, json=payload)

    assert response.status_code == 403


def test_inject_uses_tenant_from_authenticated_user_id_2():
    client = TestClient(app)
    headers = jwt_headers("2", 2, "admin")

    response = client.post(
        "/api/print-agents/jobs/inject",
        headers=headers,
        json={"payload_text": "pedido do restaurante 2"},
    )

    assert response.status_code == 200
    assert response.json()["restaurante_id"] == 2

    tenant_token = current_restaurante_id.set(2)
    db = TestingSessionLocal()
    try:
        job = db.query(PrintJob).filter(PrintJob.id == response.json()["job_id"]).one()
        assert job.restaurante_id == 2
    finally:
        db.close()
        current_restaurante_id.reset(tenant_token)


def test_inject_rejects_cross_tenant_override_for_user_id_2():
    client = TestClient(app)
    headers = jwt_headers("2", 2, "admin")

    response = client.post(
        "/api/print-agents/jobs/inject",
        headers=headers,
        json={
            "restaurante_id": 1,
            "payload_text": "tentativa de cruzar tenant",
        },
    )

    assert response.status_code == 403


def test_register_and_reprint_stay_in_authenticated_tenant_2():
    client = TestClient(app)
    headers = jwt_headers("2", 2, "admin")

    register_response = client.post(
        "/api/print-agents/register",
        headers=headers,
        json={"agent_id": "agent-restaurante-2"},
    )
    assert register_response.status_code == 200
    assert register_response.json()["restaurante_id"] == 2

    cross_tenant_response = client.post(
        "/api/print-agents/jobs/job-1001/reprint",
        headers=headers,
    )
    assert cross_tenant_response.status_code == 404

    reprint_response = client.post(
        "/api/print-agents/jobs/job-2001/reprint",
        headers=headers,
    )
    assert reprint_response.status_code == 200

    tenant_token = current_restaurante_id.set(2)
    db = TestingSessionLocal()
    try:
        reprint = db.query(PrintJob).filter(
            PrintJob.id == reprint_response.json()["new_job_id"]
        ).one()
        assert reprint.restaurante_id == 2
    finally:
        db.close()
        current_restaurante_id.reset(tenant_token)
