import sys
import os
import asyncio
import hashlib
import datetime
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from fastapi.testclient import TestClient

from app.main import app
from app.websocket_manager import ConnectionManager, notify_print_agent_jobs_available, trigger_print_agent_wakeup
from app.models import PrintAgentToken, PrintJob, Restaurante
from app.routes.print_agents import hash_token
from app.database import SessionLocal, current_restaurante_id


def test_worker_max_loops_terminates_cleanly():
    """Valida que o run_agent_loop executa exatamente max_loops iterações e encerra graciosamente."""
    agent_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../print-agent"))
    if agent_dir not in sys.path:
        sys.path.append(agent_dir)

    from config import AgentConfig
    from worker import run_agent_loop

    cfg = AgentConfig(
        api_url="http://localhost:8000",
        agent_token="mock-token",
        adapter="file",
        poll_interval_seconds=0.01,
        claim_batch_size=5,
    )

    with patch("worker.KomaApiClient") as mock_client_cls, \
         patch("worker.WssWakeupClient") as mock_wss_cls:
        
        mock_client = MagicMock()
        mock_client.heartbeat.return_value = {"command": None}
        mock_client.claim_jobs.return_value = []
        mock_client_cls.return_value = mock_client
        
        mock_wss = MagicMock()
        mock_wss_cls.return_value = mock_wss

        # Executa 1 iteração. Se a indentação estiver errada (loop infinito), o teste falhará por timeout.
        run_agent_loop(cfg, max_loops=1)

        # Assegura que o WSS stop foi invocado no cleanup gracioso
        mock_wss.stop.assert_called_once()
        assert mock_client.claim_jobs.called


def test_agent_websocket_segmentation():
    """Testa o roteamento de audiência exclusivo para a categoria 'agent' no ConnectionManager."""
    asyncio.run(_exercise_agent_websocket_segmentation())


async def _exercise_agent_websocket_segmentation():
    manager = ConnectionManager()

    internal_socket = AsyncMock()
    client_socket = AsyncMock()
    agent_socket = AsyncMock()

    restaurante_id = 100

    await manager.connect(internal_socket, restaurante_id, client_type="internal")
    await manager.connect(client_socket, restaurante_id, client_type="client")
    await manager.connect(agent_socket, restaurante_id, client_type="agent")

    # Broadcast direcionado estritamente para o agente
    print_signal = {"event": "print_jobs_available"}
    await manager.broadcast(print_signal, restaurante_id, target_audience="agent")

    # Apenas o agent_socket deve receber o sinal
    agent_socket.send_json.assert_called_with(print_signal)
    internal_socket.send_json.assert_not_called()
    client_socket.send_json.assert_not_called()

    # Reset mocks
    agent_socket.reset_mock()
    internal_socket.reset_mock()
    client_socket.reset_mock()

    # Isolamento de restaurante: restaurante 200 não deve afetar restaurante 100
    await manager.broadcast(print_signal, restaurante_id=200, target_audience="agent")
    agent_socket.send_json.assert_not_called()


def test_ws_agent_valid_and_revoked_tokens():
    """Testa conexão bem-sucedida de agente com token válido e rejeição por token revogado/inválido."""
    db = SessionLocal()
    now = datetime.datetime.now(datetime.timezone.utc)
    raw_valid = "test-ws-valid-token-888"
    raw_revoked = "test-ws-revoked-token-888"
    
    try:
        db.merge(Restaurante(id=888, nome="Restaurante WS Test 888", plano="bistro"))
        db.flush()

        db.merge(PrintAgentToken(
            id="agent-valid-888",
            restaurante_id=888,
            agent_id="desktop-valid-888",
            token_hash=hashlib.sha256(raw_valid.encode("utf-8")).hexdigest(),
            ativo=True,
            last_seen_at=now
        ))
        db.merge(PrintAgentToken(
            id="agent-revoked-888",
            restaurante_id=888,
            agent_id="desktop-revoked-888",
            token_hash=hashlib.sha256(raw_revoked.encode("utf-8")).hexdigest(),
            ativo=False,
            last_seen_at=now
        ))
        db.commit()
    finally:
        db.close()

    client = TestClient(app)

    # 1. Sem token -> Rejeitado
    with pytest.raises(Exception):
        with client.websocket_connect("/ws/agent"):
            pass

    # 2. Token revogado -> Rejeitado
    with pytest.raises(Exception):
        with client.websocket_connect("/ws/agent", headers={"X-Agent-Token": raw_revoked}):
            pass

    # 3. Token válido -> Conecta e recebe mensagem de wakeup
    with client.websocket_connect("/ws/agent", headers={"X-Agent-Token": raw_valid}) as websocket:
        trigger_print_agent_wakeup(888)
        data = websocket.receive_json()
        assert data == {"event": "print_jobs_available"}


def test_ws_agent_postgresql_rls_security_definer():
    """Testa que no dialect postgresql a rota /ws/agent utiliza koma_internal.auth_print_agent."""
    client = TestClient(app)

    db = SessionLocal()
    now = datetime.datetime.now(datetime.timezone.utc)
    raw_pg_token = "pg-auth-token-999"
    pg_hash = hashlib.sha256(raw_pg_token.encode("utf-8")).hexdigest()
    
    try:
        db.merge(Restaurante(id=999, nome="Restaurante PG Test 999", plano="bistro"))
        db.flush()
        db.merge(PrintAgentToken(
            id="agent-pg-999",
            restaurante_id=999,
            agent_id="desktop-pg-999",
            token_hash=pg_hash,
            ativo=True,
            last_seen_at=now
        ))
        db.commit()
    finally:
        db.close()

    mock_db = MagicMock()
    mock_db.get_bind.return_value.dialect.name = "postgresql"
    mock_row = MagicMock()
    mock_row.mappings.return_value.first.return_value = {"id": "agent-pg-999", "restaurante_id": 999}
    mock_db.execute.return_value = mock_row

    with patch("app.database.SessionLocal", return_value=mock_db):
        with client.websocket_connect("/ws/agent", headers={"X-Agent-Token": raw_pg_token}) as websocket:
            trigger_print_agent_wakeup(999)
            data = websocket.receive_json()
            assert data == {"event": "print_jobs_available"}

        called_sql = str(mock_db.execute.call_args[0][0])
        assert "koma_internal.auth_print_agent" in called_sql


def test_notify_print_agent_signal_format():
    """Testa se o helper de notificação envia estritamente o evento genérico sem expor payloads de cupons."""
    asyncio.run(_exercise_notify_print_agent_signal_format())


async def _exercise_notify_print_agent_signal_format():
    with patch("app.websocket_manager.manager.broadcast") as mock_broadcast:
        mock_broadcast.return_value = None

        await notify_print_agent_jobs_available(restaurante_id=55)

        mock_broadcast.assert_called_once_with(
            {"event": "print_jobs_available"},
            restaurante_id=55,
            target_audience="agent"
        )
        
        # Garantir que nenhum texto de cupom/payload_text é exposto no sinal
        called_args, called_kwargs = mock_broadcast.call_args
        event_payload = called_args[0]
        assert "payload_text" not in event_payload
        assert event_payload == {"event": "print_jobs_available"}
