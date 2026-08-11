import asyncio
from unittest.mock import AsyncMock
from app.websocket_manager import ConnectionManager


def test_websocket_audience_segmentation():
    asyncio.run(_exercise_websocket_audience_segmentation())


def test_websocket_broadcast_keeps_healthy_peers_connected():
    asyncio.run(_exercise_websocket_broadcast_failure_isolation())


async def _exercise_websocket_audience_segmentation():
    manager = ConnectionManager()
    
    # Create mock WebSockets
    internal_socket = AsyncMock()
    client_socket = AsyncMock()
    
    restaurante_id = 1
    
    # Connect sockets
    await manager.connect(internal_socket, restaurante_id, client_type="internal")
    await manager.connect(client_socket, restaurante_id, client_type="client")
    
    # 1. Broadcast waiter presence event (internal only)
    waiter_event = {"event": "waiter_connected", "garcom_id": "c-01"}
    await manager.broadcast(waiter_event, restaurante_id, target_audience="internal")
    
    internal_socket.send_json.assert_called_with(waiter_event)
    client_socket.send_json.assert_not_called()
    
    # Reset mocks
    internal_socket.reset_mock()
    client_socket.reset_mock()
    
    # 2. Broadcast waiter disconnect event (internal only)
    disconnect_event = {"event": "waiter_disconnected", "garcom_id": "c-01"}
    await manager.broadcast(disconnect_event, restaurante_id) # Should auto-resolve to internal
    
    internal_socket.send_json.assert_called_with(disconnect_event)
    client_socket.send_json.assert_not_called()
    
    # Reset mocks
    internal_socket.reset_mock()
    client_socket.reset_mock()
    
    # 3. Broadcast public catalog update event (all clients)
    catalog_event = {"type": "catalog_updated", "message": "Cardápio atualizado"}
    await manager.broadcast(catalog_event, restaurante_id) # Should auto-resolve to all
    
    internal_socket.send_json.assert_called_with(catalog_event)
    client_socket.send_json.assert_called_with(catalog_event)


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
