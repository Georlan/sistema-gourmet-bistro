"""
Testes abrangentes de regressão para fila de impressão com prioridade de agente principal.
Garante que máquinas principais consumam pedidos automáticos prioritariamente e que
agentes secundários (suporte/desenvolvimento) não roubem pedidos genéricos da produção.
"""

import datetime
import hashlib
import os
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db, current_restaurante_id
from app.models import Restaurante, Usuario, PrintAgentToken, PrintJob
from app.services.printing import enqueue_print_job
from app.routes import print_agents as print_agents_route
from app.routes.print_agents import hash_token
from app.security import create_access_token
from app.main import app

DB_FILE = "./test_print_primary.db"
SQLALCHEMY_DATABASE_URL = f"sqlite:///{DB_FILE}"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False, "timeout": 30},
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()


def mark_agent_ready(agent_record_id: str, tenant_id: int = 1) -> None:
    now = datetime.datetime.now(datetime.timezone.utc)
    token = current_restaurante_id.set(tenant_id)
    try:
        db = TestingSessionLocal()
        try:
            agent = db.query(PrintAgentToken).filter_by(id=agent_record_id).one()
            agent.last_seen_at = now
            agent.diagnostics_updated_at = now
            agent.printer_diagnostics = {
                "adapter": "windows" if "win" in agent.agent_id else "linux",
                "platform": "windows" if "win" in agent.agent_id else "linux",
                "capabilities": ["connect_usb"],
                "printers": [
                    {
                        "name": "POS80 Printer",
                        "connection": "usb",
                        "uri": "USB001",
                        "available": True,
                        "present": True,
                        "configured": True,
                        "is_default": True,
                        "dispatchable": True,
                    }
                ],
            }
            db.commit()
        finally:
            db.close()
    finally:
        current_restaurante_id.reset(token)


@pytest.fixture(autouse=True)
def setup_database(monkeypatch):
    print_agents_route._clear_invalid_agent_token_cache()
    print_agents_route._clear_print_queue_maintenance_cache()
    print_agents_route._clear_print_history_maintenance_cache()

    def test_session_local(**kwargs):
        kwargs.pop("restaurante_id", None)
        return TestingSessionLocal()

    monkeypatch.setattr(print_agents_route, "SessionLocal", test_session_local)
    token_var = current_restaurante_id.set(1)
    try:
        app.dependency_overrides[get_db] = override_get_db
        Base.metadata.drop_all(bind=engine)
        Base.metadata.create_all(bind=engine)
        db = TestingSessionLocal()

        # Restaurantes 1 (múltiplos agentes) e 2 (agente único) e 3 (dois agentes sem principal)
        db.merge(Restaurante(id=1, nome="Restaurante Principal", plano="bistro"))
        db.merge(Restaurante(id=2, nome="Restaurante Standalone", plano="bistro"))
        db.merge(Restaurante(id=3, nome="Restaurante Sem Principal", plano="bistro"))
        db.flush()

        # Usuários admin
        db.add(Usuario(id="admin-1", restaurante_id=1, nome="Admin 1", email="admin1@teste.local", cargo="admin", status="ativo"))
        db.add(Usuario(id="admin-2", restaurante_id=2, nome="Admin 2", email="admin2@teste.local", cargo="admin", status="ativo"))
        db.add(Usuario(id="admin-3", restaurante_id=3, nome="Admin 3", email="admin3@teste.local", cargo="admin", status="ativo"))

        # Restaurante 1: Agente Principal (Windows física) e Agente Secundário (Linux suporte)
        t_win = hash_token("token_win_primary")
        t_lin = hash_token("token_lin_secondary")
        db.add(PrintAgentToken(id="ag-win", restaurante_id=1, agent_id="win-caixa-real", token_hash=t_win, ativo=True, is_primary=True))
        db.add(PrintAgentToken(id="ag-lin", restaurante_id=1, agent_id="lin-suporte-dev", token_hash=t_lin, ativo=True, is_primary=False))
        db.commit()

        # Restaurante 2: Apenas 1 agente (standalone)
        t_solo = hash_token("token_tenant2_solo")
        t2_token = current_restaurante_id.set(2)
        try:
            db.add(PrintAgentToken(id="ag-solo", restaurante_id=2, agent_id="solo-agent", token_hash=t_solo, ativo=True, is_primary=False))
            db.commit()
        finally:
            current_restaurante_id.reset(t2_token)

        # Restaurante 3: Dois agentes ativos mas NENHUM marcado como is_primary
        t_3a = hash_token("token_tenant3_a")
        t_3b = hash_token("token_tenant3_b")
        t3_token = current_restaurante_id.set(3)
        try:
            db.add(PrintAgentToken(id="ag-3a", restaurante_id=3, agent_id="t3-agent-a", token_hash=t_3a, ativo=True, is_primary=False))
            db.add(PrintAgentToken(id="ag-3b", restaurante_id=3, agent_id="t3-agent-b", token_hash=t_3b, ativo=True, is_primary=False))
            db.commit()
        finally:
            current_restaurante_id.reset(t3_token)

        db.close()
        yield
    finally:
        print_agents_route._clear_invalid_agent_token_cache()
        print_agents_route._clear_print_queue_maintenance_cache()
        print_agents_route._clear_print_history_maintenance_cache()
        current_restaurante_id.reset(token_var)
        try:
            engine.dispose()
            os.remove(DB_FILE)
        except Exception:
            pass


def get_jwt(user_id: str, rest_id: int) -> dict[str, str]:
    token = create_access_token(subject=user_id, restaurante_id=rest_id, role="admin")
    return {"Authorization": f"Bearer {token}"}


def test_secondary_agent_cannot_steal_generic_order_when_polling_first():
    """
    CENÁRIO CRÍTICO P0:
    Um pedido normal (agent_id = NULL) está na fila do restaurante 1.
    O Linux secundário chega PRIMEIRO ao claim-batch.
    O Linux NÃO deve receber o pedido.
    A máquina Windows principal chega depois e consome o pedido normalmente.
    """
    mark_agent_ready("ag-win")
    mark_agent_ready("ag-lin")

    db = TestingSessionLocal()
    try:
        db.add(PrintJob(
            id="job-pedido-real-1",
            restaurante_id=1,
            document_type="producao",
            destination="COZINHA",
            source_type="pedido",
            source_id="ped-999",
            payload_text="1x File Mignon",
            status="pending",
            agent_id=None,
            idempotency_key="idemp:ped:999",
        ))
        db.commit()
    finally:
        db.close()

    client = TestClient(app)

    # 1. Linux secundário faz claim primeiro
    lin_resp = client.post(
        "/api/print-agents/jobs/claim-batch?limit=10",
        headers={"X-Agent-Token": "token_lin_secondary"},
    )
    assert lin_resp.status_code == 200
    assert lin_resp.json() == [], "Linux secundário NUNCA pode roubar pedido genérico da fila"

    # 2. Windows principal faz claim depois
    win_resp = client.post(
        "/api/print-agents/jobs/claim-batch?limit=10",
        headers={"X-Agent-Token": "token_win_primary"},
    )
    assert win_resp.status_code == 200
    claimed_jobs = win_resp.json()
    assert len(claimed_jobs) == 1
    assert claimed_jobs[0]["id"] == "job-pedido-real-1"


def test_targeted_job_to_secondary_is_only_consumed_by_secondary():
    """
    Jobs direcionados especificamente ao agente secundário (ex: teste extremo)
    são entregues apenas ao secundário e NUNCA à máquina principal.
    """
    mark_agent_ready("ag-win")
    mark_agent_ready("ag-lin")

    db = TestingSessionLocal()
    try:
        db.add(PrintJob(
            id="job-teste-linux",
            restaurante_id=1,
            document_type="producao",
            destination="COZINHA",
            source_type="teste_extremo_cardapio",
            source_id="teste-lin-1",
            payload_text="TESTE LINUX",
            status="pending",
            agent_id="lin-suporte-dev",
            idempotency_key="idemp:teste:lin:1",
        ))
        db.commit()
    finally:
        db.close()

    client = TestClient(app)

    # Windows principal tenta claim -> não deve receber o job direcionado ao Linux
    win_resp = client.post(
        "/api/print-agents/jobs/claim-batch?limit=10",
        headers={"X-Agent-Token": "token_win_primary"},
    )
    assert win_resp.status_code == 200
    assert win_resp.json() == []

    # Linux secundário tenta claim -> recebe o job dele
    lin_resp = client.post(
        "/api/print-agents/jobs/claim-batch?limit=10",
        headers={"X-Agent-Token": "token_lin_secondary"},
    )
    assert lin_resp.status_code == 200
    claimed = lin_resp.json()
    assert len(claimed) == 1
    assert claimed[0]["id"] == "job-teste-linux"


def test_targeted_job_to_primary_is_only_consumed_by_primary():
    """Jobs direcionados à máquina principal não vão para o secundário."""
    mark_agent_ready("ag-win")
    mark_agent_ready("ag-lin")

    db = TestingSessionLocal()
    try:
        db.add(PrintJob(
            id="job-teste-win",
            restaurante_id=1,
            document_type="producao",
            destination="COZINHA",
            source_type="teste_extremo_garcom",
            source_id="teste-win-1",
            payload_text="TESTE WINDOWS",
            status="pending",
            agent_id="win-caixa-real",
            idempotency_key="idemp:teste:win:1",
        ))
        db.commit()
    finally:
        db.close()

    client = TestClient(app)

    # Linux secundário tenta claim
    lin_resp = client.post(
        "/api/print-agents/jobs/claim-batch?limit=10",
        headers={"X-Agent-Token": "token_lin_secondary"},
    )
    assert lin_resp.status_code == 200
    assert lin_resp.json() == []

    # Windows principal recebe
    win_resp = client.post(
        "/api/print-agents/jobs/claim-batch?limit=10",
        headers={"X-Agent-Token": "token_win_primary"},
    )
    assert win_resp.status_code == 200
    assert len(win_resp.json()) == 1
    assert win_resp.json()[0]["id"] == "job-teste-win"


def test_standalone_tenant_single_agent_claims_generic_jobs_automatically():
    """
    Restaurante com apenas 1 agente (sem configuração manual de is_primary)
    continua consumindo pedidos normais perfeitamente.
    """
    token = current_restaurante_id.set(2)
    try:
        mark_agent_ready("ag-solo", tenant_id=2)
        db = TestingSessionLocal()
        try:
            db.add(PrintJob(
                id="job-solo-tenant",
                restaurante_id=2,
                document_type="producao",
                destination="COZINHA",
                source_type="pedido",
                source_id="ped-solo",
                payload_text="1x Pizza Calabresa",
                status="pending",
                agent_id=None,
                idempotency_key="idemp:solo:1",
            ))
            db.commit()
        finally:
            db.close()

        client = TestClient(app)
        resp = client.post(
            "/api/print-agents/jobs/claim-batch?limit=10",
            headers={"X-Agent-Token": "token_tenant2_solo"},
        )
        assert resp.status_code == 200
        claimed = resp.json()
        assert len(claimed) == 1
        assert claimed[0]["id"] == "job-solo-tenant"
    finally:
        current_restaurante_id.reset(token)


def test_multiple_agents_without_primary_configured_blocks_silent_race():
    """
    Restaurante com 2 agentes onde nenhum está configurado como is_primary:
    NENHUM dos dois rouba jobs genéricos por corrida silenciosa.
    Apenas jobs explicitamente direcionados podem ser consumidos.
    """
    token = current_restaurante_id.set(3)
    try:
        mark_agent_ready("ag-3a", tenant_id=3)
        mark_agent_ready("ag-3b", tenant_id=3)

        db = TestingSessionLocal()
        try:
            # Job genérico
            db.add(PrintJob(
                id="job-t3-generico",
                restaurante_id=3,
                document_type="producao",
                destination="COZINHA",
                source_type="pedido",
                source_id="ped-t3",
                payload_text="1x Hambúrguer",
                status="pending",
                agent_id=None,
                idempotency_key="idemp:t3:gen",
            ))
            # Job direcionado ao agente 3b
            db.add(PrintJob(
                id="job-t3-direcionado-b",
                restaurante_id=3,
                document_type="producao",
                destination="COZINHA",
                source_type="teste_extremo_cardapio",
                source_id="ped-t3-b",
                payload_text="1x Teste B",
                status="pending",
                agent_id="t3-agent-b",
                idempotency_key="idemp:t3:b",
            ))
            db.commit()
        finally:
            db.close()

        client = TestClient(app)

        # Agente 3a tenta claim -> não recebe o genérico (ambiguidade de múltiplos agentes)
        resp_3a = client.post(
            "/api/print-agents/jobs/claim-batch?limit=10",
            headers={"X-Agent-Token": "token_tenant3_a"},
        )
        assert resp_3a.status_code == 200
        assert resp_3a.json() == []

        # Agente 3b tenta claim -> não recebe o genérico, mas RECEBE o direcionado a ele!
        resp_3b = client.post(
            "/api/print-agents/jobs/claim-batch?limit=10",
            headers={"X-Agent-Token": "token_tenant3_b"},
        )
        assert resp_3b.status_code == 200
        claimed_3b = resp_3b.json()
        assert len(claimed_3b) == 1
        assert claimed_3b[0]["id"] == "job-t3-direcionado-b"
    finally:
        current_restaurante_id.reset(token)


def test_tenant_isolation_never_leaks_jobs_across_restaurants():
    """Agentes de um restaurante nunca conseguem ver ou dar claim em jobs de outro restaurante."""
    mark_agent_ready("ag-win", tenant_id=1)
    db = TestingSessionLocal()
    try:
        db.add(PrintJob(
            id="job-rest-1",
            restaurante_id=1,
            document_type="producao",
            destination="COZINHA",
            source_type="pedido",
            source_id="p1",
            payload_text="Rest 1",
            status="pending",
            idempotency_key="idemp:leak:1",
        ))
        db.commit()
    finally:
        db.close()

    token2 = current_restaurante_id.set(2)
    try:
        mark_agent_ready("ag-solo", tenant_id=2)
        db2 = TestingSessionLocal()
        try:
            db2.add(PrintJob(
                id="job-rest-2",
                restaurante_id=2,
                document_type="producao",
                destination="COZINHA",
                source_type="pedido",
                source_id="p2",
                payload_text="Rest 2",
                status="pending",
                idempotency_key="idemp:leak:2",
            ))
            db2.commit()
        finally:
            db2.close()
    finally:
        current_restaurante_id.reset(token2)

    client = TestClient(app)

    # Agente do restaurante 1 só pega job-rest-1 (contexto do teste está com 1)
    resp_1 = client.post(
        "/api/print-agents/jobs/claim-batch?limit=10",
        headers={"X-Agent-Token": "token_win_primary"},
    )
    assert resp_1.status_code == 200
    assert [j["id"] for j in resp_1.json()] == ["job-rest-1"]

    # Agente do restaurante 2 só pega job-rest-2 (contexto do teste chaveado para 2)
    token2_req = current_restaurante_id.set(2)
    try:
        resp_2 = client.post(
            "/api/print-agents/jobs/claim-batch?limit=10",
            headers={"X-Agent-Token": "token_tenant2_solo"},
        )
        assert resp_2.status_code == 200
        assert [j["id"] for j in resp_2.json()] == ["job-rest-2"]
    finally:
        current_restaurante_id.reset(token2_req)


def test_complete_batch_only_accepts_claiming_agent():
    """Apenas o agente que realizou o claim pode confirmar a conclusão do job."""
    mark_agent_ready("ag-win")
    mark_agent_ready("ag-lin")

    db = TestingSessionLocal()
    try:
        db.add(PrintJob(
            id="job-claim-ack",
            restaurante_id=1,
            document_type="producao",
            destination="COZINHA",
            source_type="pedido",
            source_id="p-ack",
            payload_text="Comida",
            status="claimed",
            agent_id="win-caixa-real",
            idempotency_key="idemp:ack:1",
        ))
        db.commit()
    finally:
        db.close()

    client = TestClient(app)

    # Linux secundário tenta completar o job do Windows -> rejeitado
    lin_ack = client.post(
        "/api/print-agents/jobs/complete-batch",
        headers={"X-Agent-Token": "token_lin_secondary"},
        json={"jobs": [{"job_id": "job-claim-ack", "printer_name": "KA-1445"}]},
    )
    assert lin_ack.status_code == 200
    assert "job-claim-ack" in lin_ack.json()["rejected_job_ids"]
    assert lin_ack.json()["confirmed_job_ids"] == []

    # Windows principal completa com sucesso
    win_ack = client.post(
        "/api/print-agents/jobs/complete-batch",
        headers={"X-Agent-Token": "token_win_primary"},
        json={"jobs": [{"job_id": "job-claim-ack", "printer_name": "POS80"}]},
    )
    assert win_ack.status_code == 200
    assert win_ack.json()["confirmed_job_ids"] == ["job-claim-ack"]


def test_release_batch_and_stuck_recovery_preserves_targeted_destination():
    """
    1. Release-batch devolve job claimed para pending.
    2. Jobs direcionados a testes mantêm seu agent_id original no recovery e retry.
    """
    mark_agent_ready("ag-lin")

    now = datetime.datetime.now(datetime.timezone.utc)
    stuck_time = now - datetime.timedelta(minutes=10)
    db = TestingSessionLocal()
    try:
        # Job de teste direcionado que travou em claimed
        db.add(PrintJob(
            id="job-stuck-targeted",
            restaurante_id=1,
            document_type="producao",
            destination="COZINHA",
            source_type="teste_extremo_cardapio",
            source_id="targeted-stuck",
            payload_text="Teste",
            status="claimed",
            claimed_at=stuck_time,
            agent_id="lin-suporte-dev",
            idempotency_key="idemp:stuck:targeted",
        ))
        db.commit()
    finally:
        db.close()

    client = TestClient(app)

    # Ao consultar next pelo agente Linux, recovery roda
    resp = client.get(
        "/api/print-agents/jobs/next",
        headers={"X-Agent-Token": "token_lin_secondary"},
    )
    assert resp.status_code == 200
    recovered_job = resp.json()
    assert recovered_job is not None
    assert recovered_job["id"] == "job-stuck-targeted"

    # Verifica no banco que o job manteve o agent_id 'lin-suporte-dev'
    db = TestingSessionLocal()
    try:
        stored = db.query(PrintJob).filter_by(id="job-stuck-targeted").one()
        assert stored.agent_id == "lin-suporte-dev", "Recovery de job direcionado NUNCA pode limpar o agent_id"
    finally:
        db.close()


def test_retry_failed_jobs_preserves_targeted_agent():
    """Retry-batch restaura job failed para pending preservando agent_id de testes direcionados."""
    db = TestingSessionLocal()
    try:
        db.add(PrintJob(
            id="job-failed-targeted",
            restaurante_id=1,
            document_type="producao",
            destination="COZINHA",
            source_type="teste_extremo_cardapio",
            source_id="failed-tgt",
            payload_text="Teste",
            status="failed",
            agent_id="lin-suporte-dev",
            idempotency_key="idemp:failed:tgt",
        ))
        db.commit()
    finally:
        db.close()

    client = TestClient(app)
    admin_auth = get_jwt("admin-1", 1)
    retry_resp = client.post(
        "/api/print-agents/jobs/retry-batch",
        headers=admin_auth,
        json={"job_ids": ["job-failed-targeted"]},
    )
    assert retry_resp.status_code == 200
    assert retry_resp.json()["retried_job_ids"] == ["job-failed-targeted"]

    db = TestingSessionLocal()
    try:
        stored = db.query(PrintJob).filter_by(id="job-failed-targeted").one()
        assert stored.status == "pending"
        assert stored.agent_id == "lin-suporte-dev"
    finally:
        db.close()


@pytest.mark.parametrize("primary_online", [True, False])
def test_register_support_agent_cannot_take_restaurant_queue_even_if_primary_offline(primary_online):
    """Registration from the administrator's device is not a primary switch."""
    now = datetime.datetime.now(datetime.timezone.utc)
    db = TestingSessionLocal()
    try:
        existing = db.query(PrintAgentToken).filter_by(id="ag-win").one()
        existing.last_seen_at = now if primary_online else now - datetime.timedelta(minutes=10)
        db.commit()
    finally:
        db.close()

    client = TestClient(app)
    registered = client.post(
        "/api/print-agents/register",
        headers=get_jwt("admin-1", 1),
        # Simulates an older browser that automatically requested is_primary.
        json={"agent_id": "administrator-office", "is_primary": True},
    )
    assert registered.status_code == 200, registered.text
    secondary_token = registered.json()["agent_token"]

    db = TestingSessionLocal()
    try:
        primary = db.query(PrintAgentToken).filter_by(id="ag-win").one()
        secondary = db.query(PrintAgentToken).filter_by(
            restaurante_id=1, agent_id="administrator-office"
        ).one()
        assert primary.is_primary is True
        assert secondary.is_primary is False
        secondary_record_id = secondary.id
        db.add_all([
            PrintJob(
                id="restaurant-production", restaurante_id=1,
                document_type="producao", destination="COZINHA",
                source_type="pedido", source_id="customer-order",
                payload_text="Order for restaurant", status="pending",
                agent_id=None, idempotency_key="idemp:primary:production",
            ),
            PrintJob(
                id="explicit-office-test", restaurante_id=1,
                document_type="producao", destination="COZINHA",
                source_type="teste_extremo_cardapio", source_id="office-test",
                payload_text="Explicit test for administrator", status="pending",
                agent_id="administrator-office", idempotency_key="idemp:primary:test",
            ),
        ])
        db.commit()
    finally:
        db.close()

    # Registration alone does not establish printer readiness.
    mark_agent_ready(secondary_record_id)
    # Even when the restaurant has temporarily stopped sending heartbeats,
    # the support computer may only claim a job explicitly targeted to it.
    office = client.post(
        "/api/print-agents/jobs/claim-batch?limit=10",
        headers={"X-Agent-Token": secondary_token},
    )
    assert office.status_code == 200, office.text
    assert [job["id"] for job in office.json()] == ["explicit-office-test"]

    # The restaurant reconnects before it can consume its own queue.
    mark_agent_ready("ag-win")
    restaurant = client.post(
        "/api/print-agents/jobs/claim-batch?limit=10",
        headers={"X-Agent-Token": "token_win_primary"},
    )
    assert restaurant.status_code == 200, restaurant.text
    assert [job["id"] for job in restaurant.json()] == ["restaurant-production"]


def test_register_secondary_preserves_legacy_only_agent_without_primary_flag():
    """A legacy standalone printer must keep receiving orders after a new pairing."""
    context = current_restaurante_id.set(2)
    try:
        client = TestClient(app)
        registered = client.post(
            "/api/print-agents/register",
            headers=get_jwt("admin-2", 2),
            json={"agent_id": "office-support", "is_primary": True},
        )
        assert registered.status_code == 200, registered.text

        db = TestingSessionLocal()
        try:
            old = db.query(PrintAgentToken).filter_by(id="ag-solo").one()
            new = db.query(PrintAgentToken).filter_by(
                restaurante_id=2, agent_id="office-support"
            ).one()
            assert old.is_primary is True
            assert new.is_primary is False
        finally:
            db.close()
    finally:
        current_restaurante_id.reset(context)


def test_targeted_reprint_keeps_original_queue_and_goes_only_to_admin_device():
    """Manual backup is a second ticket, not a claim of the restaurant order."""
    mark_agent_ready("ag-win")
    mark_agent_ready("ag-lin")
    db = TestingSessionLocal()
    try:
        db.add(PrintJob(
            id="job-original-admin-backup", restaurante_id=1,
            document_type="producao", destination="COZINHA", source_type="pedido",
            source_id="p-backup", payload_text="1 sandwich", status="pending",
            agent_id=None, idempotency_key="idemp:admin-backup",
        ))
        db.commit()
    finally:
        db.close()

    client = TestClient(app)
    auth = get_jwt("admin-1", 1)
    response = client.post(
        "/api/print-agents/jobs/job-original-admin-backup/reprint"
        "?agent_id=lin-suporte-dev", headers=auth,
    )
    assert response.status_code == 200, response.text
    copy_id = response.json()["new_job_id"]
    assert copy_id != "job-original-admin-backup"

    db = TestingSessionLocal()
    try:
        original = db.query(PrintJob).filter_by(id="job-original-admin-backup").one()
        copy = db.query(PrintJob).filter_by(id=copy_id).one()
        assert original.status == "pending" and original.agent_id is None
        assert copy.status == "pending" and copy.agent_id == "lin-suporte-dev"
        assert copy.idempotency_key.startswith("reprint:targeted:")
    finally:
        db.close()

    secondary = client.post(
        "/api/print-agents/jobs/claim-batch?limit=10",
        headers={"X-Agent-Token": "token_lin_secondary"},
    )
    assert secondary.status_code == 200, secondary.text
    assert [job["id"] for job in secondary.json()] == [copy_id]

    primary = client.post(
        "/api/print-agents/jobs/claim-batch?limit=10",
        headers={"X-Agent-Token": "token_win_primary"},
    )
    assert primary.status_code == 200, primary.text
    assert [job["id"] for job in primary.json()] == ["job-original-admin-backup"]


def test_targeted_reprint_rejects_another_tenants_agent():
    db = TestingSessionLocal()
    try:
        db.add(PrintJob(
            id="job-isolated-copy", restaurante_id=1,
            document_type="producao", destination="COZINHA",
            source_type="pedido", source_id="p-isolated",
            payload_text="Sensitive tenant order", status="printed",
            idempotency_key="idemp:isolated-copy",
        ))
        db.commit()
    finally:
        db.close()

    client = TestClient(app)
    response = client.post(
        "/api/print-agents/jobs/job-isolated-copy/reprint"
        "?agent_id=solo-agent", headers=get_jwt("admin-1", 1),
    )
    assert response.status_code == 404
    db = TestingSessionLocal()
    try:
        assert db.query(PrintJob).filter_by(restaurante_id=1).count() == 1
    finally:
        db.close()


def test_targeted_reprint_recovery_keeps_destination_for_retry_and_stuck_claim():
    now = datetime.datetime.now(datetime.timezone.utc)
    db = TestingSessionLocal()
    try:
        db.add(PrintJob(
            id="job-target-recovery", restaurante_id=1,
            document_type="producao", destination="COZINHA",
            source_type="pedido", source_id="p-target-recovery",
            payload_text="Targeted copy", status="claimed",
            claimed_at=now - datetime.timedelta(minutes=10),
            agent_id="lin-suporte-dev",
            idempotency_key="reprint:targeted:original:123",
        ))
        db.commit()
        assert print_agents_route._release_stuck_jobs(db, 1, now) == 1
        db.commit()
        recovered = db.query(PrintJob).filter_by(id="job-target-recovery").one()
        assert recovered.status == "pending"
        assert recovered.agent_id == "lin-suporte-dev"
        recovered.status = "failed"
        db.commit()
    finally:
        db.close()

    client = TestClient(app)
    response = client.post(
        "/api/print-agents/jobs/retry-batch",
        headers=get_jwt("admin-1", 1),
        json={"job_ids": ["job-target-recovery"]},
    )
    assert response.status_code == 200, response.text
    db = TestingSessionLocal()
    try:
        recovered = db.query(PrintJob).filter_by(id="job-target-recovery").one()
        assert recovered.status == "pending"
        assert recovered.agent_id == "lin-suporte-dev"
    finally:
        db.close()


def test_release_batch_preserves_targeted_reprint_destination():
    db = TestingSessionLocal()
    try:
        db.add(PrintJob(
            id="job-target-release", restaurante_id=1,
            document_type="producao", destination="COZINHA",
            source_type="pedido", source_id="release-copy",
            payload_text="Targeted copy", status="claimed",
            agent_id="lin-suporte-dev",
            idempotency_key="reprint:targeted:original:release",
        ))
        db.commit()
    finally:
        db.close()
    response = TestClient(app).post(
        "/api/print-agents/jobs/release-batch",
        headers={"X-Agent-Token": "token_lin_secondary"},
        json={"job_ids": ["job-target-release"]},
    )
    assert response.status_code == 200, response.text
    assert response.json()["released_job_ids"] == ["job-target-release"]
    db = TestingSessionLocal()
    try:
        job = db.query(PrintJob).filter_by(id="job-target-release").one()
        assert job.status == "pending"
        assert job.agent_id == "lin-suporte-dev"
    finally:
        db.close()


def test_set_primary_agent_endpoint_switches_priority_and_updates_monitor():
    """
    Endpoint administrativo /set-primary alterna qual máquina é o agente principal.
    A máquina anterior vira secundária e a nova vira principal.
    """
    client = TestClient(app)
    admin_auth = get_jwt("admin-1", 1)

    # 1. Altera agente principal para lin-suporte-dev
    set_resp = client.post(
        "/api/print-agents/set-primary",
        headers=admin_auth,
        json={"agent_id": "lin-suporte-dev"},
    )
    assert set_resp.status_code == 200
    assert set_resp.json()["primary_agent_id"] == "lin-suporte-dev"

    # 2. Verifica no monitor
    mon_resp = client.get("/api/print-agents/monitor", headers=admin_auth)
    assert mon_resp.status_code == 200
    mon_data = mon_resp.json()
    assert mon_data["summary"]["primary_agent_id"] == "lin-suporte-dev"

    agents_map = {a["agent_id"]: a for a in mon_data["agents"]}
    assert agents_map["lin-suporte-dev"]["is_primary"] is True
    assert agents_map["lin-suporte-dev"]["role"] == "primary"
    assert agents_map["win-caixa-real"]["is_primary"] is False
    assert agents_map["win-caixa-real"]["role"] == "secondary"

    # 3. Agora um job genérico vai para o Linux (novo principal), e não para o Windows
    mark_agent_ready("ag-win")
    mark_agent_ready("ag-lin")
    db = TestingSessionLocal()
    try:
        db.add(PrintJob(
            id="job-novo-principal",
            restaurante_id=1,
            document_type="producao",
            destination="COZINHA",
            source_type="pedido",
            source_id="p-switch",
            payload_text="Pedido",
            status="pending",
            agent_id=None,
            idempotency_key="idemp:switch:1",
        ))
        db.commit()
    finally:
        db.close()

    # Windows (antigo principal) não recebe mais jobs genéricos
    win_resp = client.post(
        "/api/print-agents/jobs/claim-batch?limit=10",
        headers={"X-Agent-Token": "token_win_primary"},
    )
    assert win_resp.status_code == 200
    assert win_resp.json() == []

    # Linux (novo principal) recebe
    lin_resp = client.post(
        "/api/print-agents/jobs/claim-batch?limit=10",
        headers={"X-Agent-Token": "token_lin_secondary"},
    )
    assert lin_resp.status_code == 200
    assert len(lin_resp.json()) == 1
    assert lin_resp.json()[0]["id"] == "job-novo-principal"


def test_legacy_endpoint_get_next_and_claim_respects_primary_priority():
    """Endpoints legados /jobs/next e /jobs/{id}/claim também respeitam a prioridade de agente principal."""
    mark_agent_ready("ag-win")
    mark_agent_ready("ag-lin")

    db = TestingSessionLocal()
    try:
        db.add(PrintJob(
            id="job-legacy-generic",
            restaurante_id=1,
            document_type="producao",
            destination="COZINHA",
            source_type="pedido",
            source_id="p-leg",
            payload_text="Legado",
            status="pending",
            agent_id=None,
            idempotency_key="idemp:leg:1",
        ))
        db.commit()
    finally:
        db.close()

    client = TestClient(app)

    # Linux secundário tenta /jobs/next -> retorna None
    lin_next = client.get(
        "/api/print-agents/jobs/next",
        headers={"X-Agent-Token": "token_lin_secondary"},
    )
    assert lin_next.status_code == 200
    assert lin_next.json() is None

    # Linux secundário tenta forçar claim unitário -> 409 Conflict
    lin_claim = client.post(
        "/api/print-agents/jobs/job-legacy-generic/claim",
        headers={"X-Agent-Token": "token_lin_secondary"},
    )
    assert lin_claim.status_code == 409
    assert "secundário" in lin_claim.json()["detail"]

    # Windows principal pega no /jobs/next
    win_next = client.get(
        "/api/print-agents/jobs/next",
        headers={"X-Agent-Token": "token_win_primary"},
    )
    assert win_next.status_code == 200
    assert win_next.json() is not None
    assert win_next.json()["id"] == "job-legacy-generic"

    # E Windows principal faz claim com sucesso
    win_claim = client.post(
        "/api/print-agents/jobs/job-legacy-generic/claim",
        headers={"X-Agent-Token": "token_win_primary"},
    )
    assert win_claim.status_code == 200
    assert win_claim.json()["id"] == "job-legacy-generic"


def test_repeated_manual_reprint_coalesces_same_copy_but_preserves_original():
    """O clique manual cria uma via; cliques seguintes não criam cópias extras."""
    with TestingSessionLocal() as db:
        original = enqueue_print_job(
            db,
            restaurante_id=1,
            document_type="producao",
            destination="COZINHA",
            source_type="pedido",
            source_id="c-repeat-11",
            payload_text="PEDIDO #11",
            idempotency_key="aceite:pedido:c-repeat-11:producao:cozinha",
            printing_allowed=True,
        )
        assert original is not None
        first_reprint_id = None
        for suffix in ("one", "two", "three"):
            repeated = enqueue_print_job(
                db,
                restaurante_id=1,
                document_type="producao",
                destination="COZINHA",
                source_type="reimpressao",
                source_id="c-repeat-11",
                payload_text="PEDIDO #11 - REIMPRESSAO",
                idempotency_key=f"universal:reimpressao:c-repeat-11:cozinha:{suffix}",
                printing_allowed=True,
            )
            assert repeated is not None
            if first_reprint_id is None:
                first_reprint_id = repeated.id
                assert first_reprint_id != original.id
            assert repeated.id == first_reprint_id
        db.commit()
        assert db.query(PrintJob).filter(
            PrintJob.restaurante_id == 1,
            PrintJob.source_id == "c-repeat-11",
        ).count() == 2


def test_recently_printed_manual_reprint_has_short_cooldown():
    """Não bloqueia reimpressões futuras, só rajadas após impressão recente."""
    now = datetime.datetime.now(datetime.timezone.utc)
    with TestingSessionLocal() as db:
        db.add(PrintJob(
            id="job-already-reprinted",
            restaurante_id=1,
            document_type="producao",
            destination="COZINHA",
            source_type="reimpressao",
            source_id="c-cooldown",
            payload_text="REIMPRESSAO",
            status="printed",
            printed_at=now,
            idempotency_key="reprint:cooldown:first",
        ))
        db.commit()
        duplicate = enqueue_print_job(
            db, restaurante_id=1, document_type="producao",
            destination="COZINHA", source_type="reimpressao",
            source_id="c-cooldown", payload_text="REIMPRESSAO",
            idempotency_key="reprint:cooldown:duplicate", printing_allowed=True,
        )
        assert duplicate is not None
        assert duplicate.id == "job-already-reprinted"
        db.add(PrintJob(
            id="job-old-reprint",
            restaurante_id=1, document_type="producao",
            destination="BAR", source_type="reimpressao",
            source_id="c-cooldown", payload_text="BAR",
            status="printed", printed_at=now - datetime.timedelta(minutes=3),
            idempotency_key="reprint:cooldown:old",
        ))
        db.flush()
        another = enqueue_print_job(
            db, restaurante_id=1, document_type="producao",
            destination="BAR", source_type="reimpressao",
            source_id="c-cooldown", payload_text="BAR",
            idempotency_key="reprint:cooldown:new", printing_allowed=True,
        )
        assert another is not None
        assert another.id != "job-old-reprint"


def test_reconnecting_primary_claims_one_manual_copy_per_original_not_backlog():
    """A fila do JE libera originais e uma via manual, nunca 8 duplicatas."""
    mark_agent_ready("ag-win")
    now = datetime.datetime.now(datetime.timezone.utc)
    jobs = []
    for number in (11, 12):
        source = f"c-regression-{number}"
        jobs.append(PrintJob(
            id=f"original-{number}", restaurante_id=1,
            document_type="producao", destination="COZINHA",
            source_type="pedido", source_id=source,
            payload_text=f"PEDIDO #{number}", status="pending",
            created_at=now - datetime.timedelta(minutes=4),
            idempotency_key=f"auto:{source}",
        ))
        for click in range(4):
            jobs.append(PrintJob(
                id=f"duplicate-{number}-{click}", restaurante_id=1,
                document_type="producao", destination="COZINHA",
                source_type="reimpressao", source_id=source,
                payload_text=f"REIMPRESSAO #{number}", status="pending",
                created_at=now - datetime.timedelta(minutes=3, seconds=-click),
                idempotency_key=f"reprint:{source}:{click}",
            ))
    with TestingSessionLocal() as db:
        db.add_all(jobs)
        db.commit()

    response = TestClient(app).post(
        "/api/print-agents/jobs/claim-batch?limit=10",
        headers={"X-Agent-Token": "token_win_primary"},
    )
    assert response.status_code == 200, response.text
    assert {job["id"] for job in response.json()} == {
        "original-11", "original-12", "duplicate-11-0", "duplicate-12-0",
    }
    with TestingSessionLocal() as db:
        queued = db.query(PrintJob).filter(PrintJob.restaurante_id == 1).all()
        assert sum(job.status == "claimed" for job in queued) == 4
        assert sum(job.status == "cancelled" for job in queued) == 6
        assert all(job.status != "pending" for job in queued)


def test_reconnecting_after_original_printed_preserves_one_manual_copy():
    """Sem original na fila, apenas uma via de reimpressão é necessária."""
    mark_agent_ready("ag-win")
    now = datetime.datetime.now(datetime.timezone.utc)
    with TestingSessionLocal() as db:
        db.add(PrintJob(
            id="printed-original", restaurante_id=1,
            document_type="producao", destination="COZINHA",
            source_type="pedido", source_id="c-copy",
            payload_text="ORIGINAL", status="printed", printed_at=now,
            idempotency_key="auto:copy",
        ))
        for click in range(3):
            db.add(PrintJob(
                id=f"repeat-copy-{click}", restaurante_id=1,
                document_type="producao", destination="COZINHA",
                source_type="reimpressao", source_id="c-copy",
                payload_text="COPY", status="pending",
                created_at=now - datetime.timedelta(seconds=30 - click),
                idempotency_key=f"reprint:copy:{click}",
            ))
        db.commit()

    response = TestClient(app).post(
        "/api/print-agents/jobs/claim-batch?limit=10",
        headers={"X-Agent-Token": "token_win_primary"},
    )
    assert response.status_code == 200, response.text
    assert [job["id"] for job in response.json()] == ["repeat-copy-0"]
    with TestingSessionLocal() as db:
        assert db.query(PrintJob).filter(
            PrintJob.restaurante_id == 1,
            PrintJob.status == "cancelled",
        ).count() == 2


def test_same_source_different_print_content_preserves_distinct_copies():
    """Duas mesas com fragmentos distintos não são deduplicadas entre si."""
    with TestingSessionLocal() as db:
        first = enqueue_print_job(
            db, restaurante_id=1, document_type="producao",
            destination="COZINHA", source_type="reimpressao",
            source_id="l-split", payload_text="MESA: 3 - ITEM A",
            idempotency_key="reprint:split:m3", printing_allowed=True,
        )
        second = enqueue_print_job(
            db, restaurante_id=1, document_type="producao",
            destination="COZINHA", source_type="reimpressao",
            source_id="l-split", payload_text="MESA: 5 - ITEM B",
            idempotency_key="reprint:split:m5", printing_allowed=True,
        )
        duplicate = enqueue_print_job(
            db, restaurante_id=1, document_type="producao",
            destination="COZINHA", source_type="reimpressao",
            source_id="l-split", payload_text="MESA: 3 - ITEM A",
            idempotency_key="reprint:split:m3-again", printing_allowed=True,
        )
        assert first is not None and second is not None and duplicate is not None
        assert first.id != second.id
        assert first.id == duplicate.id
        db.commit()
        assert db.query(PrintJob).filter(
            PrintJob.restaurante_id == 1,
            PrintJob.source_id == "l-split",
        ).count() == 2


@pytest.mark.parametrize("generic_status", ["pending", "claimed"])
def test_targeted_copy_is_not_coalesced_with_generic_reprint(generic_status):
    db = TestingSessionLocal()
    try:
        for job_id, target, key in [
            ("generic-copy", None, "reprint:generic:1"),
            ("directed-copy", "lin-suporte-dev", "reprint:targeted:generic:2"),
        ]:
            db.add(PrintJob(
                id=job_id, restaurante_id=1, document_type="producao",
                destination="COZINHA", source_type="reimpressao",
                source_id="same-order", payload_text="same-ticket",
                status=generic_status if job_id == "generic-copy" else "pending",
                agent_id=("win-principal" if job_id == "generic-copy" and generic_status == "claimed" else target),
                idempotency_key=key,
            ))
        db.commit()
        print_agents_route._coalesce_pending_reprints(db, 1)
        db.commit()
        assert db.query(PrintJob).filter_by(id="generic-copy").one().status == generic_status
        copy = db.query(PrintJob).filter_by(id="directed-copy").one()
        assert copy.status == "pending"
        assert copy.agent_id == "lin-suporte-dev"
    finally:
        db.close()
