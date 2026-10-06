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
