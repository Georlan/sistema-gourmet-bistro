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
        db.flush()

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
