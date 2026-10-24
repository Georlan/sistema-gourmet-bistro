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


def test_internal_websocket_negotiates_auth_subprotocol():
    async def exercise():
        manager = ConnectionManager()
        socket = AsyncMock()
        await manager.connect(
            socket,
            9,
            client_type="internal",
            subprotocol="koma-auth",
        )
        socket.accept.assert_awaited_once_with(subprotocol="koma-auth")

    asyncio.run(exercise())


def test_catalog_invalidation_never_reaches_another_tenant():
    async def exercise():
        manager = ConnectionManager()
        own_internal, own_client, foreign_internal, foreign_client = [AsyncMock() for _ in range(4)]
        for socket, tenant, audience in [(own_internal, 501, 'internal'), (own_client, 501, 'client'),
                                         (foreign_internal, 502, 'internal'), (foreign_client, 502, 'client')]:
            await manager.connect(socket, tenant, client_type=audience)
        event = {'event': 'catalog_updated'}
        await manager.broadcast(event, 501)
        own_internal.send_json.assert_awaited_once_with(event)
        own_client.send_json.assert_awaited_once_with(event)
        foreign_internal.send_json.assert_not_awaited()
        foreign_client.send_json.assert_not_awaited()
    asyncio.run(exercise())


def test_presence_fanout_with_5000_isolated_restaurants_and_10000_waiters():
    """Routing simulation, not a real network/production capacity benchmark."""
    class Peer:
        def __init__(self):
            self.messages = []

        async def accept(self, **kwargs):
            pass

        async def send_json(self, message):
            self.messages.append(message)

    async def exercise():
        manager = ConnectionManager()
        peers = {}
        for tenant in range(100_000, 105_000):
            peers[tenant] = [Peer(), Peer()]
            for index, peer in enumerate(peers[tenant]):
                await manager.connect(peer, tenant, user_id=f'waiter-{index}')
        public_peer = Peer()
        await manager.connect(public_peer, 100_042, client_type='client')
        message = {'event': 'draft_status', 'mesa_id': 7, 'ativo': True, 'garcom_id': 'waiter-0'}
        await manager.broadcast(message, 100_042)
        assert len(manager.identities) == 10_000
        assert len(manager.active_connections) == 5_000
        for tenant, pair in peers.items():
            assert all(peer.messages == ([message] if tenant == 100_042 else []) for peer in pair)
        assert public_peer.messages == []
        manager.disconnect(peers[100_042][0], 100_042)
        await manager.broadcast({'event': 'waiter_disconnected'}, 100_042)
        assert len(peers[100_042][1].messages) == 2
        assert len(peers[100_042][0].messages) == 1

    asyncio.run(exercise())
