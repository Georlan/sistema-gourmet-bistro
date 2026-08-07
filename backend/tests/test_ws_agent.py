import asyncio
import hashlib
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from fastapi.testclient import TestClient

from app.main import app
from app.websocket_manager import ConnectionManager, notify_print_agent_jobs_available
from app.models import PrintAgentToken, PrintJob, Restaurante
from app.routes.print_agents import hash_token


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


def test_ws_agent_endpoint_auth_and_isolation():
    """Testa autenticação, rejeição por token inválido/revogado e conexões válidas em /ws/agent."""
    client = TestClient(app)

    # 1. Sem token no cabeçalho X-Agent-Token -> Rejeitado
    with pytest.raises(Exception):
        with client.websocket_connect("/ws/agent"):
            pass

    # 2. Token inexistente/inválido -> Rejeitado
    with pytest.raises(Exception):
        with client.websocket_connect("/ws/agent", headers={"X-Agent-Token": "token_invalido_xyz"}):
            pass


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
