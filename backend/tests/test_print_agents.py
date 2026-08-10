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
from app.routes import print_agents as print_agents_route
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
def setup_database(monkeypatch):
    def test_session_local(**kwargs):
        kwargs.pop("restaurante_id", None)
        return TestingSessionLocal()

    monkeypatch.setattr(
        print_agents_route,
        "SessionLocal",
        test_session_local,
    )
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


def mark_agent_printer_ready(agent_id: str) -> None:
    now = datetime.datetime.now(datetime.timezone.utc)
    db = TestingSessionLocal()
    try:
        agent = db.query(PrintAgentToken).filter_by(id=agent_id).one()
        agent.last_seen_at = now
        agent.diagnostics_updated_at = now
        agent.printer_diagnostics = {
            "adapter": "linux",
            "platform": "linux",
            "capabilities": ["connect_usb"],
            "default_printer": "G250",
            "printers": [
                {
                    "name": "G250",
                    "connection": "usb",
                    "uri": "usb://GERTEC/G250",
                    "is_default": True,
                    "available": True,
                    "present": True,
                    "configured": True,
                }
            ],
            "error": None,
        }
        db.commit()
    finally:
        db.close()


def test_atomic_claim_job_success():
    """Agente 1 faz o claim com sucesso."""
    mark_agent_printer_ready("a1")
    client = TestClient(app)
    headers = {"X-Agent-Token": "token_agent_1"}

    resp = client.post("/api/print-agents/jobs/job-1001/claim", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["id"] == "job-1001"


def test_concurrent_claim_second_agent_gets_conflict():
    """Agente 2 tentando o claim do mesmo job já assumido deve receber HTTP 409 Conflict."""
    mark_agent_printer_ready("a1")
    mark_agent_printer_ready("a2")
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
    mark_agent_printer_ready("a1")
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
    mark_agent_printer_ready("a1")
    mark_agent_printer_ready("a2")
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


def test_claim_batch_reserves_fifo_without_duplicate():
    """Uma rajada usa uma reserva HTTP e mantém a ordem da fila."""
    mark_agent_printer_ready("a1")
    mark_agent_printer_ready("a2")
    now = datetime.datetime.now(datetime.timezone.utc)
    db = TestingSessionLocal()
    try:
        first = db.query(PrintJob).filter_by(id="job-1001").one()
        first.created_at = now
        for index in range(2, 4):
            db.add(
                PrintJob(
                    id=f"job-batch-{index}",
                    restaurante_id=1,
                    document_type="producao",
                    destination="COZINHA",
                    source_type="comanda",
                    source_id=f"cmd-{index}",
                    payload_text=f"Pedido {index}",
                    status="pending",
                    idempotency_key=f"idemp:batch:{index}",
                    created_at=now + datetime.timedelta(seconds=index),
                )
            )
        db.commit()
    finally:
        db.close()

    client = TestClient(app)
    first_response = client.post(
        "/api/print-agents/jobs/claim-batch?limit=10",
        headers={"X-Agent-Token": "token_agent_1"},
    )
    second_response = client.post(
        "/api/print-agents/jobs/claim-batch?limit=10",
        headers={"X-Agent-Token": "token_agent_2"},
    )

    assert first_response.status_code == 200
    assert [
        job["id"]
        for job in first_response.json()
    ] == ["job-1001", "job-batch-2", "job-batch-3"]
    assert second_response.status_code == 200
    assert second_response.json() == []


def test_complete_batch_is_idempotent_and_agent_scoped():
    """A resposta perdida pode ser repetida sem duplicar a impressão."""
    mark_agent_printer_ready("a1")
    mark_agent_printer_ready("a2")
    client = TestClient(app)
    claimed = client.post(
        "/api/print-agents/jobs/claim-batch?limit=10",
        headers={"X-Agent-Token": "token_agent_1"},
    )
    assert claimed.status_code == 200
    assert [job["id"] for job in claimed.json()] == ["job-1001"]

    body = {
        "jobs": [
            {
                "job_id": "job-1001",
                "printer_name": "G250",
            }
        ]
    }
    first = client.post(
        "/api/print-agents/jobs/complete-batch",
        headers={"X-Agent-Token": "token_agent_1"},
        json=body,
    )
    repeated = client.post(
        "/api/print-agents/jobs/complete-batch",
        headers={"X-Agent-Token": "token_agent_1"},
        json=body,
    )
    wrong_agent = client.post(
        "/api/print-agents/jobs/complete-batch",
        headers={"X-Agent-Token": "token_agent_2"},
        json=body,
    )

    assert first.status_code == 200
    assert first.json()["confirmed_job_ids"] == ["job-1001"]
    assert repeated.status_code == 200
    assert repeated.json()["confirmed_job_ids"] == ["job-1001"]
    assert wrong_agent.status_code == 200
    assert wrong_agent.json()["confirmed_job_ids"] == []
    assert wrong_agent.json()["rejected_job_ids"] == ["job-1001"]

    db = TestingSessionLocal()
    try:
        job = db.query(PrintJob).filter_by(id="job-1001").one()
        assert job.status == "printed"
        assert job.printer_name == "G250"
        assert job.printed_at is not None
    finally:
        db.close()


def test_release_batch_returns_only_unprinted_jobs_to_queue():
    mark_agent_printer_ready("a1")
    client = TestClient(app)
    claimed = client.post(
        "/api/print-agents/jobs/claim-batch?limit=10",
        headers={"X-Agent-Token": "token_agent_1"},
    )
    assert claimed.status_code == 200

    response = client.post(
        "/api/print-agents/jobs/release-batch",
        headers={"X-Agent-Token": "token_agent_1"},
        json={"job_ids": ["job-1001"]},
    )

    assert response.status_code == 200
    assert response.json()["released_job_ids"] == ["job-1001"]
    db = TestingSessionLocal()
    try:
        job = db.query(PrintJob).filter_by(id="job-1001").one()
        assert job.status == "pending"
        assert job.agent_id is None
        assert job.claimed_at is None
        assert job.attempts == 0
    finally:
        db.close()


def test_stuck_job_recovery():
    """Jobs em 'claimed' há mais de 5min são liberados automaticamente no /jobs/next."""
    mark_agent_printer_ready("a1")
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
    """Heartbeat registra presença e o último diagnóstico limitado do agente."""
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
        json={
            "diagnostics": {
                "adapter": "linux",
                "platform": "linux",
                "default_printer": "G250",
                "printers": [
                    {
                        "name": "G250",
                        "connection": "usb",
                        "uri": "usb://GERTEC/G250",
                        "is_default": True,
                        "available": True,
                        "present": True,
                        "configured": True,
                    }
                ],
            }
        },
    )
    assert heartbeat_response.status_code == 200

    db = TestingSessionLocal()
    try:
        agent = db.query(PrintAgentToken).filter_by(id="a1").one()
        assert agent.last_seen_at is not None
        assert agent.diagnostics_updated_at is not None
        assert agent.printer_diagnostics["printers"][0]["name"] == "G250"
        assert (
            agent.printer_diagnostics["printers"][0]["connection"]
            == "usb"
        )
        assert agent.printer_diagnostics["printers"][0]["present"] is True
        assert agent.printer_diagnostics["printers"][0]["configured"] is True
    finally:
        db.close()


def test_legacy_heartbeat_without_body_remains_accepted():
    client = TestClient(app)

    response = client.post(
        "/api/print-agents/heartbeat",
        headers={"X-Agent-Token": "token_agent_1"},
    )

    assert response.status_code == 200


def test_claim_next_keeps_job_pending_without_physical_printer():
    client = TestClient(app)

    response = client.post(
        "/api/print-agents/jobs/claim-next",
        headers={"X-Agent-Token": "token_agent_1"},
    )

    assert response.status_code == 200
    assert response.json() is None
    db = TestingSessionLocal()
    try:
        job = db.query(PrintJob).filter_by(id="job-1001").one()
        assert job.status == "pending"
        assert job.agent_id is None
    finally:
        db.close()


def test_print_test_is_rejected_without_physical_printer():
    client = TestClient(app)

    response = client.post(
        "/api/print-agents/jobs/inject",
        headers=jwt_headers("2", 2, "admin"),
        json={
            "source_type": "teste_painel",
            "source_id": "teste-sem-usb",
            "payload_text": "TESTE REAL DO KÔMA PRINT",
        },
    )

    assert response.status_code == 409
    assert "nenhuma impressora física" in response.json()["detail"]


def test_print_test_is_enqueued_with_recent_ready_printer():
    now = datetime.datetime.now(datetime.timezone.utc)
    db = TestingSessionLocal()
    try:
        agent = PrintAgentToken(
            id="a-ready-tenant-2",
            restaurante_id=2,
            agent_id="agent-ready-tenant-2",
            token_hash=hash_token("ready-token"),
            ativo=True,
            last_seen_at=now,
            diagnostics_updated_at=now,
            printer_diagnostics={
                "adapter": "linux",
                "platform": "linux",
                "printers": [
                    {
                        "name": "G250",
                        "connection": "usb",
                        "uri": "usb://GERTEC/G250",
                        "is_default": True,
                        "available": True,
                        "present": True,
                        "configured": True,
                    }
                ],
            },
        )
        db.add(agent)
        db.commit()
    finally:
        db.close()

    client = TestClient(app)
    response = client.post(
        "/api/print-agents/jobs/inject",
        headers=jwt_headers("2", 2, "admin"),
        json={
            "source_type": "teste_painel",
            "source_id": "teste-com-usb",
            "payload_text": "TESTE REAL DO KÔMA PRINT",
        },
    )

    assert response.status_code == 200
    assert response.json()["status"] == "enqueued"


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


def test_print_monitor_reports_tenant_health_delays_and_spooler_state():
    now = datetime.datetime.now(datetime.timezone.utc)
    tenant_token = current_restaurante_id.set(2)
    db = TestingSessionLocal()
    try:
        db.add(PrintAgentToken(
            id="agent-online-2",
            restaurante_id=2,
            agent_id="desktop-caixa-2",
            token_hash=hash_token("online-agent-token"),
            ativo=True,
            last_seen_at=now - datetime.timedelta(seconds=20),
            printer_diagnostics={
                "adapter": "linux",
                "platform": "linux",
                "default_printer": "G250",
                "printers": [
                    {
                        "name": "G250",
                        "connection": "usb",
                        "uri": "usb://GERTEC/G250",
                        "is_default": True,
                        "available": True,
                    }
                ],
                "error": None,
            },
            diagnostics_updated_at=now - datetime.timedelta(seconds=20),
        ))
        db.add(PrintAgentToken(
            id="agent-offline-2",
            restaurante_id=2,
            agent_id="desktop-antigo-2",
            token_hash=hash_token("offline-agent-token"),
            ativo=True,
            last_seen_at=now - datetime.timedelta(minutes=10),
        ))
        db.add(PrintJob(
            id="job-delayed-2",
            restaurante_id=2,
            document_type="producao",
            destination="COZINHA",
            source_type="pedido",
            source_id="pedido-atrasado",
            payload_text="1x pedido atrasado",
            status="pending",
            idempotency_key="idemp:delayed:2",
            created_at=now - datetime.timedelta(minutes=5),
        ))
        db.add(PrintJob(
            id="job-printed-2",
            restaurante_id=2,
            document_type="fechamento",
            destination="FECHAMENTO",
            source_type="comanda",
            source_id="mesa-2",
            payload_text=(
                "KÔMA\n"
                "PEDIDO: #305                 MESA: 3\n"
                "TOTAL GERAL DA MESA: R$ 42,00"
            ),
            status="printed",
            idempotency_key="idemp:printed:2",
            agent_id="desktop-caixa-2",
            printer_name="G250",
            created_at=now - datetime.timedelta(minutes=2),
            printed_at=now - datetime.timedelta(minutes=1),
        ))
        db.add(PrintJob(
            id="job-production-reference-2",
            restaurante_id=2,
            document_type="producao",
            destination="COZINHA",
            source_type="pedido",
            source_id="c-98929afa",
            payload_text=(
                "KÔMA\n"
                "PED #9516                       MESA 2\n"
                "CONSUMO NO LOCAL"
            ),
            status="cancelled",
            idempotency_key="idemp:reference:2",
            created_at=now - datetime.timedelta(minutes=3),
        ))
        db.commit()
    finally:
        db.close()
        current_restaurante_id.reset(tenant_token)

    client = TestClient(app)
    response = client.get(
        "/api/print-agents/monitor",
        headers=jwt_headers("2", 2, "admin"),
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["summary"]["online_agents"] == 1
    assert payload["summary"]["active_agents"] == 2
    assert payload["summary"]["delayed"] == 1
    assert payload["physical_completion_tracking"] is False

    agent_ids = {agent["agent_id"] for agent in payload["agents"]}
    assert agent_ids == {"desktop-caixa-2", "desktop-antigo-2"}
    online_agent = next(
        agent
        for agent in payload["agents"]
        if agent["agent_id"] == "desktop-caixa-2"
    )
    assert (
        online_agent["printer_diagnostics"]["printers"][0]["name"]
        == "G250"
    )
    assert online_agent["diagnostics_updated_at"] is not None

    jobs = {job["id"]: job for job in payload["jobs"]}
    assert "job-1001" not in jobs
    assert jobs["job-delayed-2"]["delayed"] is True
    assert jobs["job-printed-2"]["display_status"] == "spooler_accepted"
    assert jobs["job-printed-2"]["physical_confirmation"] == "not_available"
    assert jobs["job-printed-2"]["can_reprint"] is True
    assert jobs["job-printed-2"]["reference"] == "Pedido #305 · Mesa 3"
    assert jobs["job-printed-2"]["order_number"] == "305"
    assert jobs["job-printed-2"]["table_number"] == "3"
    assert (
        jobs["job-production-reference-2"]["reference"]
        == "Pedido #9516 · Mesa 2"
    )
    latest_success = payload["latest_spooler_success"]
    assert latest_success["job_id"] == "job-printed-2"
    assert latest_success["reference"] == "Pedido #305 · Mesa 3"
    assert latest_success["printer_name"] == "G250"
    assert latest_success["printed_at"] == jobs["job-printed-2"]["printed_at"]
    assert 0 <= latest_success["age_seconds"] < 120


def test_print_monitor_rejects_waiter():
    client = TestClient(app)

    response = client.get(
        "/api/print-agents/monitor",
        headers=jwt_headers("garcom-2", 2, "garcom"),
    )

    assert response.status_code == 403


def test_admin_can_connect_usb_and_agent_reports_result():
    now = datetime.datetime.now(datetime.timezone.utc)
    tenant_token = current_restaurante_id.set(2)
    db = TestingSessionLocal()
    try:
        db.add(PrintAgentToken(
            id="agent-command-2",
            restaurante_id=2,
            agent_id="desktop-command-2",
            token_hash=hash_token("command-agent-token"),
            ativo=True,
            last_seen_at=now,
            printer_diagnostics={
                "adapter": "linux",
                "platform": "linux",
                "capabilities": ["connect_usb"],
                "printers": [],
                "default_printer": None,
                "error": None,
            },
            diagnostics_updated_at=now,
        ))
        db.commit()
    finally:
        db.close()
        current_restaurante_id.reset(tenant_token)

    client = TestClient(app)
    requested = client.post(
        "/api/print-agents/actions/connect-usb",
        headers=jwt_headers("2", 2, "admin"),
        json={
            "agent_id": "desktop-command-2",
            "printer_name": "G250",
            "printer_uri": "usb://GERTEC/G250",
        },
    )

    assert requested.status_code == 200
    command = requested.json()["command"]
    assert command["action"] == "connect_usb"
    assert command["printer_name"] == "G250"

    heartbeat = client.post(
        "/api/print-agents/heartbeat",
        headers={"X-Agent-Token": "command-agent-token"},
        json={},
    )
    assert heartbeat.status_code == 200
    assert heartbeat.json()["command"]["id"] == command["id"]

    completed = client.post(
        f"/api/print-agents/actions/{command['id']}/complete",
        headers={"X-Agent-Token": "command-agent-token"},
        json={
            "success": True,
            "code": "usb_connected",
            "message": "Impressora USB conectada e pronta para uso.",
            "printer_name": "G250",
            "diagnostics": {
                "adapter": "linux",
                "platform": "linux",
                "capabilities": ["connect_usb"],
                "default_printer": "G250",
                "printers": [
                    {
                        "name": "G250",
                        "connection": "usb",
                        "uri": "usb://GERTEC/G250",
                        "is_default": True,
                        "available": True,
                        "present": True,
                        "configured": True,
                    }
                ],
                "error": None,
            },
        },
    )
    assert completed.status_code == 200

    repeated = client.post(
        f"/api/print-agents/actions/{command['id']}/complete",
        headers={"X-Agent-Token": "command-agent-token"},
        json={
            "success": True,
            "code": "usb_connected",
            "message": "Impressora USB conectada e pronta para uso.",
            "printer_name": "G250",
        },
    )
    assert repeated.status_code == 200
    assert repeated.json()["status"] == "already_completed"

    monitor = client.get(
        "/api/print-agents/monitor",
        headers=jwt_headers("2", 2, "admin"),
    )
    assert monitor.status_code == 200
    agent = next(
        item
        for item in monitor.json()["agents"]
        if item["agent_id"] == "desktop-command-2"
    )
    assert agent["pending_command"] is None
    assert agent["last_command_result"]["id"] == command["id"]
    assert agent["last_command_result"]["success"] is True
    assert agent["printer_ready"] is True


def test_usb_connection_rejects_legacy_agent_without_command_support():
    now = datetime.datetime.now(datetime.timezone.utc)
    tenant_token = current_restaurante_id.set(2)
    db = TestingSessionLocal()
    try:
        db.add(PrintAgentToken(
            id="legacy-agent-2",
            restaurante_id=2,
            agent_id="legacy-desktop-2",
            token_hash=hash_token("legacy-agent-token"),
            ativo=True,
            last_seen_at=now,
            printer_diagnostics={
                "adapter": "linux",
                "platform": "linux",
                "printers": [],
                "default_printer": None,
                "error": None,
            },
            diagnostics_updated_at=now,
        ))
        db.commit()
    finally:
        db.close()
        current_restaurante_id.reset(tenant_token)

    response = TestClient(app).post(
        "/api/print-agents/actions/connect-usb",
        headers=jwt_headers("2", 2, "admin"),
        json={"agent_id": "legacy-desktop-2"},
    )

    assert response.status_code == 409
    detail = response.json()["detail"]
    assert "conexão USB" in detail
    assert "agente" not in detail.casefold()
    assert "versão" not in detail.casefold()
    assert "desatualizado" not in detail.casefold()


def test_print_monitor_expires_usb_command_without_agent_heartbeat(
    monkeypatch,
):
    monkeypatch.setattr(
        print_agents_route,
        "AGENT_COMMAND_TIMEOUT_SECONDS",
        1,
    )
    now = datetime.datetime.now(datetime.timezone.utc)
    command_id = "usb_stale_command"
    tenant_token = current_restaurante_id.set(2)
    db = TestingSessionLocal()
    try:
        db.add(PrintAgentToken(
            id="stale-command-agent-2",
            restaurante_id=2,
            agent_id="stale-command-desktop-2",
            token_hash=hash_token("stale-command-token"),
            ativo=True,
            last_seen_at=now,
            printer_diagnostics={
                "adapter": "linux",
                "platform": "linux",
                "capabilities": ["connect_usb"],
                "printers": [],
                "default_printer": None,
                "error": None,
            },
            diagnostics_updated_at=now,
            pending_command={
                "id": command_id,
                "action": "connect_usb",
                "requested_at": (
                    now - datetime.timedelta(seconds=5)
                ).isoformat(),
            },
            command_requested_at=(
                now - datetime.timedelta(seconds=5)
            ),
        ))
        db.commit()
    finally:
        db.close()
        current_restaurante_id.reset(tenant_token)

    response = TestClient(app).get(
        "/api/print-agents/monitor",
        headers=jwt_headers("2", 2, "admin"),
    )

    assert response.status_code == 200
    assert response.json()["command_timeout_seconds"] == 1
    agent = next(
        item
        for item in response.json()["agents"]
        if item["agent_id"] == "stale-command-desktop-2"
    )
    assert agent["pending_command"] is None
    assert agent["last_command_result"]["id"] == command_id
    assert agent["last_command_result"]["code"] == "command_expired"
    assert agent["last_command_result"]["success"] is False


def test_usb_connection_action_is_tenant_scoped_and_rejects_waiter():
    now = datetime.datetime.now(datetime.timezone.utc)
    tenant_token = current_restaurante_id.set(1)
    db = TestingSessionLocal()
    try:
        agent = db.query(PrintAgentToken).filter_by(id="a1").one()
        agent.last_seen_at = now
        db.commit()
    finally:
        db.close()
        current_restaurante_id.reset(tenant_token)

    client = TestClient(app)
    cross_tenant = client.post(
        "/api/print-agents/actions/connect-usb",
        headers=jwt_headers("2", 2, "admin"),
        json={"agent_id": "agent-box-1"},
    )
    waiter = client.post(
        "/api/print-agents/actions/connect-usb",
        headers=jwt_headers("garcom-2", 2, "garcom"),
        json={},
    )

    assert cross_tenant.status_code == 404
    assert waiter.status_code == 403


def test_print_monitor_shows_only_the_latest_20_jobs_from_today():
    now = datetime.datetime.now(datetime.timezone.utc)
    tenant_token = current_restaurante_id.set(2)
    try:
        db = TestingSessionLocal()
        try:
            existing = db.query(PrintJob).filter_by(id="job-2001").one()
            existing.created_at = now - datetime.timedelta(minutes=1)
            for index in range(25):
                db.add(
                    PrintJob(
                        id=f"job-today-{index:02d}",
                        restaurante_id=2,
                        document_type="fechamento",
                        destination="FECHAMENTO",
                        source_type="comanda",
                        source_id=f"mesa-{index}",
                        payload_text=f"MESA {index}",
                        status="printed",
                        idempotency_key=f"idemp:today:{index}",
                        created_at=now - datetime.timedelta(
                            minutes=index + 2
                        ),
                        printed_at=now - datetime.timedelta(
                            minutes=index + 1
                        ),
                    )
                )
            db.add(
                PrintJob(
                    id="job-yesterday",
                    restaurante_id=2,
                    document_type="fechamento",
                    destination="FECHAMENTO",
                    source_type="comanda",
                    source_id="mesa-antiga",
                    payload_text="MESA ANTIGA",
                    status="printed",
                    idempotency_key="idemp:yesterday",
                    created_at=now - datetime.timedelta(days=1),
                    printed_at=now - datetime.timedelta(days=1),
                )
            )
            db.commit()
        finally:
            db.close()
    finally:
        current_restaurante_id.reset(tenant_token)

    response = TestClient(app).get(
        "/api/print-agents/monitor",
        headers=jwt_headers("2", 2, "admin"),
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["history_limit"] == 20
    assert len(payload["jobs"]) == 20
    assert "job-yesterday" not in {
        job["id"]
        for job in payload["jobs"]
    }


def test_print_monitor_keeps_recovery_queue_separate_from_history():
    now = datetime.datetime.now(datetime.timezone.utc)
    tenant_token = current_restaurante_id.set(2)
    try:
        db = TestingSessionLocal()
        try:
            db.add_all([
                PrintJob(
                    id="job-recovery-pending",
                    restaurante_id=2,
                    document_type="producao",
                    destination="COZINHA",
                    source_type="pedido",
                    source_id="pending",
                    payload_text="PENDENTE",
                    status="pending",
                    idempotency_key="recovery:pending",
                    created_at=now - datetime.timedelta(hours=4),
                ),
                PrintJob(
                    id="job-recovery-failed",
                    restaurante_id=2,
                    document_type="producao",
                    destination="COZINHA",
                    source_type="pedido",
                    source_id="failed",
                    payload_text="FALHOU",
                    status="failed",
                    attempts=3,
                    idempotency_key="recovery:failed",
                    created_at=now - datetime.timedelta(hours=3),
                ),
            ])
            db.commit()
        finally:
            db.close()
    finally:
        current_restaurante_id.reset(tenant_token)

    response = TestClient(app).get(
        "/api/print-agents/monitor",
        headers=jwt_headers("2", 2, "admin"),
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["queue_limit"] == 50
    queue_ids = [job["id"] for job in payload["queue_jobs"]]
    assert "job-recovery-pending" in queue_ids
    assert "job-recovery-failed" in queue_ids
    assert "job-recovery-pending" not in {
        job["id"] for job in payload["history_jobs"]
    }


def test_retry_batch_reuses_failed_job_without_creating_duplicate():
    tenant_token = current_restaurante_id.set(2)
    try:
        db = TestingSessionLocal()
        try:
            db.add(
                PrintJob(
                    id="job-retry-original",
                    restaurante_id=2,
                    document_type="producao",
                    destination="COZINHA",
                    source_type="pedido",
                    source_id="retry",
                    payload_text="CUPOM REAL",
                    status="failed",
                    attempts=3,
                    agent_id="agent-box-2",
                    idempotency_key="retry:original",
                )
            )
            db.commit()
        finally:
            db.close()
    finally:
        current_restaurante_id.reset(tenant_token)

    response = TestClient(app).post(
        "/api/print-agents/jobs/retry-batch",
        headers=jwt_headers("2", 2, "admin"),
        json={"job_ids": ["job-retry-original"]},
    )

    assert response.status_code == 200
    assert response.json()["retried_job_ids"] == ["job-retry-original"]
    tenant_token = current_restaurante_id.set(2)
    try:
        db = TestingSessionLocal()
        try:
            job = db.query(PrintJob).filter_by(id="job-retry-original").one()
            assert job.status == "pending"
            assert job.attempts == 0
            assert job.agent_id is None
            assert db.query(PrintJob).filter_by(
                idempotency_key="retry:original"
            ).count() == 1
        finally:
            db.close()
    finally:
        current_restaurante_id.reset(tenant_token)


def test_history_maintenance_compacts_old_payloads_but_keeps_queue():
    now = datetime.datetime.now(datetime.timezone.utc)
    tenant_token = current_restaurante_id.set(2)
    try:
        db = TestingSessionLocal()
        try:
            for index in range(23):
                db.add(
                    PrintJob(
                        id=f"job-retention-{index:02d}",
                        restaurante_id=2,
                        document_type="fechamento",
                        destination="FECHAMENTO",
                        source_type="comanda",
                        source_id=f"mesa-{index}",
                        payload_text=f"CUPOM COMPLETO {index}",
                        status="printed",
                        idempotency_key=f"idemp:retention:{index}",
                        created_at=now - datetime.timedelta(minutes=index),
                        printed_at=now - datetime.timedelta(minutes=index),
                    )
                )
            db.add(
                PrintJob(
                    id="job-retention-yesterday",
                    restaurante_id=2,
                    document_type="fechamento",
                    destination="FECHAMENTO",
                    source_type="comanda",
                    source_id="mesa-yesterday",
                    payload_text="CUPOM DE ONTEM",
                    status="printed",
                    idempotency_key="idemp:retention:yesterday",
                    created_at=now - datetime.timedelta(days=1),
                    printed_at=now - datetime.timedelta(days=1),
                )
            )
            db.add(
                PrintJob(
                    id="job-expired-tombstone",
                    restaurante_id=2,
                    document_type="fechamento",
                    destination="FECHAMENTO",
                    source_type="comanda",
                    source_id="mesa-expired",
                    payload_text="",
                    status="printed",
                    idempotency_key="idemp:retention:expired",
                    created_at=now - datetime.timedelta(days=8),
                    printed_at=now - datetime.timedelta(days=8),
                )
            )
            db.commit()
        finally:
            db.close()
    finally:
        current_restaurante_id.reset(tenant_token)

    print_agents_route._run_print_history_maintenance(2, now)

    tenant_token = current_restaurante_id.set(2)
    try:
        db = TestingSessionLocal()
        try:
            terminal_jobs = (
                db.query(PrintJob)
                .filter(
                    PrintJob.restaurante_id == 2,
                    PrintJob.status == "printed",
                )
                .all()
            )
            retained_payloads = [
                job
                for job in terminal_jobs
                if job.payload_text
            ]
            assert len(retained_payloads) == 20
            assert (
                db.query(PrintJob)
                .filter_by(id="job-retention-yesterday")
                .one()
                .payload_text
                == ""
            )
            assert (
                db.query(PrintJob)
                .filter_by(id="job-expired-tombstone")
                .first()
                is None
            )
            pending = db.query(PrintJob).filter_by(id="job-2001").one()
            assert pending.status == "pending"
            assert pending.payload_text == "1x Pedido tenant 2"
        finally:
            db.close()
    finally:
        current_restaurante_id.reset(tenant_token)


def test_compacted_print_can_no_longer_be_reprinted():
    tenant_token = current_restaurante_id.set(2)
    try:
        db = TestingSessionLocal()
        try:
            job = db.query(PrintJob).filter_by(id="job-2001").one()
            job.status = "printed"
            job.payload_text = ""
            db.commit()
        finally:
            db.close()
    finally:
        current_restaurante_id.reset(tenant_token)

    response = TestClient(app).post(
        "/api/print-agents/jobs/job-2001/reprint",
        headers=jwt_headers("2", 2, "admin"),
    )

    assert response.status_code == 410
