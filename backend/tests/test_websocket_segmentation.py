import asyncio
from unittest.mock import AsyncMock

from fastapi import BackgroundTasks

from app.routes.cardapio_digital import notify_cardapio_config_update
from app.websocket_manager import ConnectionManager, manager as global_manager


def test_websocket_audience_segmentation():
    asyncio.run(_exercise_websocket_audience_segmentation())


def test_websocket_broadcast_keeps_healthy_peers_connected():
    asyncio.run(_exercise_websocket_broadcast_failure_isolation())


def test_cardapio_config_update_schedules_tenant_invalidation():
    background_tasks = BackgroundTasks()

    notify_cardapio_config_update(background_tasks, 17)

    assert len(background_tasks.tasks) == 1
    task = background_tasks.tasks[0]
    assert task.func == global_manager.broadcast
    assert task.args == ({"event": "config_updated"}, 17)


async def _exercise_websocket_audience_segmentation():
    manager = ConnectionManager()

    internal_socket = AsyncMock()
    client_socket = AsyncMock()

    restaurante_id = 1

    await manager.connect(internal_socket, restaurante_id, client_type="internal")
    await manager.connect(client_socket, restaurante_id, client_type="client")

    # Eventos operacionais permanecem internos.
    waiter_event = {"event": "waiter_connected", "garcom_id": "c-01"}
    await manager.broadcast(waiter_event, restaurante_id, target_audience="internal")

    internal_socket.send_json.assert_called_with(waiter_event)
    client_socket.send_json.assert_not_called()

    internal_socket.reset_mock()
    client_socket.reset_mock()

    disconnect_event = {"event": "waiter_disconnected", "garcom_id": "c-01"}
    await manager.broadcast(disconnect_event, restaurante_id)

    internal_socket.send_json.assert_called_with(disconnect_event)
    client_socket.send_json.assert_not_called()

    internal_socket.reset_mock()
    client_socket.reset_mock()

    # Alterações do catálogo precisam chegar ao Caixa/Garçom e ao cardápio público.
    catalog_event = {"type": "catalog_updated", "message": "Cardápio atualizado"}
    await manager.broadcast(catalog_event, restaurante_id)

    internal_socket.send_json.assert_called_with(catalog_event)
    client_socket.send_json.assert_called_with(catalog_event)

    internal_socket.reset_mock()
    client_socket.reset_mock()

    # Whitelabel, logo e banner compartilham a mesma invalidação pública.
    config_event = {"event": "config_updated"}
    await manager.broadcast(config_event, restaurante_id)

    internal_socket.send_json.assert_called_with(config_event)
    client_socket.send_json.assert_called_with(config_event)


async def _exercise_websocket_broadcast_failure_isolation():
    manager = ConnectionManager()
    failing_socket = AsyncMock()
    healthy_socket = AsyncMock()
    failing_socket.send_json.side_effect = RuntimeError("peer disconnected")

    await manager.connect(failing_socket, 7, client_type="internal")
    await manager.connect(healthy_socket, 7, client_type="internal")

    event = {"event": "tables_updated"}
    await manager.broadcast(event, 7)

    healthy_socket.send_json.assert_called_once_with(event)
    assert failing_socket not in manager.active_connections[7]["internal"]
    assert healthy_socket in manager.active_connections[7]["internal"]
