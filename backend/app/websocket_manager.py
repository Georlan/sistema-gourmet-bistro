import asyncio
import logging
import uuid
from fastapi import WebSocket

from .services.operational_realtime_bus import OperationalRealtimeBus

logger = logging.getLogger(__name__)

# Events that public clients (/ws/cliente) are permitted to receive
PUBLIC_CLIENT_EVENTS = {
    "config_updated",
    "catalog_updated",
    "store_status_changed",
    "order_status_updated",
    "order_updated",
}

class ConnectionManager:
    def __init__(self, *, shared_transport: bool = False) -> None:
        # Keeps track of active WebSocket connections grouped by restaurante_id and client_type
        # Structure: { restaurante_id: { "internal": [WebSocket...], "client": [WebSocket...] } }
        self.active_connections: dict[int, dict[str, list[WebSocket]]] = {}
        self.identities: dict[WebSocket, tuple[int, str, asyncio.AbstractEventLoop]] = {}
        self._loop: asyncio.AbstractEventLoop | None = None
        self.bus = OperationalRealtimeBus(self._on_bus_event) if shared_transport else None

    def start(self) -> None:
        self._loop = asyncio.get_running_loop()
        if self.bus:
            self.bus.start()

    def stop(self) -> None:
        if self.bus:
            self.bus.stop()

    def _on_bus_event(self, envelope: dict) -> None:
        if self.bus and envelope.get("origin") == self.bus.instance_id:
            return
        rid = envelope.get("restaurante_id")
        if not isinstance(rid, int) or isinstance(rid, bool) or rid <= 0:
            return
        loop = self._loop
        if loop is None or loop.is_closed():
            return
        if envelope.get("action") == "revoke":
            user_id = envelope.get("user_id")
            if user_id is None or isinstance(user_id, str):
                loop.call_soon_threadsafe(self._revoke_local, rid, user_id)
        elif envelope.get("action") == "broadcast":
            message = envelope.get("message")
            audience = envelope.get("audience")
            if isinstance(message, dict) and audience in {"internal", "client", "all"}:
                loop.call_soon_threadsafe(
                    lambda: asyncio.create_task(self._broadcast_local(message, rid, audience))
                )

    @staticmethod
    def _audience(message: dict, target_audience: str | None) -> str:
        if target_audience in {"internal", "client", "all"}:
            return target_audience
        event_name = message.get("event") or message.get("type") or ""
        return "all" if event_name in PUBLIC_CLIENT_EVENTS else "internal"

    def _envelope(self, action: str, restaurante_id: int, **fields) -> dict:
        return {
            "version": 1, "event_id": uuid.uuid4().hex,
            "origin": self.bus.instance_id if self.bus else None,
            "action": action, "restaurante_id": restaurante_id, **fields,
        }

    def queue_committed_broadcast(self, db, message: dict, restaurante_id: int, *, target_audience: str | None = None) -> None:
        if not self.bus:
            db.info.setdefault("operational_realtime_after_commit", []).append(
                self._envelope("broadcast", restaurante_id, message=message, audience=self._audience(message, target_audience))
            )
            return
        envelope = self._envelope("broadcast", restaurante_id, message=message, audience=self._audience(message, target_audience))
        # No local send occurred: the publishing process must consume this after commit too.
        envelope["origin"] = None
        self.bus.queue_committed(db, envelope)

    async def connect(
        self,
        websocket: WebSocket,
        restaurante_id: int,
        client_type: str = "internal",
        subprotocol: str | None = None,
        user_id: str | None = None,
    ) -> None:
        if not isinstance(restaurante_id, int) or isinstance(restaurante_id, bool) or restaurante_id <= 0:
            logger.warning("Conexão WebSocket rejeitada: restaurante_id ausente ou inválido.")
            try:
                await websocket.close(code=1008)
            except Exception:
                pass
            return

        if self.bus:
            await websocket.accept(subprotocol=subprotocol, headers=[
                (b"x-koma-instance", self.bus.instance_id[:8].encode())
            ])
        else:
            await websocket.accept(subprotocol=subprotocol)
        self._loop = asyncio.get_running_loop()
        if user_id is not None:
            self.identities[websocket] = (restaurante_id, user_id, asyncio.get_running_loop())

        if restaurante_id not in self.active_connections:
            self.active_connections[restaurante_id] = {"internal": [], "client": []}

        if client_type not in self.active_connections[restaurante_id]:
            self.active_connections[restaurante_id][client_type] = []

        if websocket not in self.active_connections[restaurante_id][client_type]:
            self.active_connections[restaurante_id][client_type].append(websocket)
        logger.info(f"WebSocket conectado: restaurante_id={restaurante_id}, client_type={client_type}")

    def disconnect(self, websocket: WebSocket, restaurante_id: int | None = None) -> None:
        self.identities.pop(websocket, None)
        if restaurante_id is not None and isinstance(restaurante_id, int) and not isinstance(restaurante_id, bool) and restaurante_id > 0:
            if restaurante_id in self.active_connections:
                for ctype, connections in list(self.active_connections[restaurante_id].items()):
                    if websocket in connections:
                        connections.remove(websocket)
                if not any(self.active_connections[restaurante_id].values()):
                    del self.active_connections[restaurante_id]
        else:
            for rid, ctype_dict in list(self.active_connections.items()):
                for ctype, connections in list(ctype_dict.items()):
                    if websocket in connections:
                        connections.remove(websocket)
                if not any(ctype_dict.values()):
                    del self.active_connections[rid]

    def revoke(self, restaurante_id: int, user_id: str | None = None) -> None:
        """Called after commit, including from synchronous request threads."""
        self._revoke_local(restaurante_id, user_id)
        if self.bus:
            try:
                self.bus.publish(self._envelope("revoke", restaurante_id, user_id=user_id))
            except Exception as exc:
                logger.warning("Cross-process WebSocket revocation publish failed: %s", type(exc).__name__)

    def _revoke_local(self, restaurante_id: int, user_id: str | None = None) -> None:
        for socket, (rid, uid, loop) in list(self.identities.items()):
            if rid != restaurante_id or (user_id is not None and uid != user_id):
                continue
            def close_connection(ws=socket, tenant=rid):
                self.disconnect(ws, tenant)
                async def close():
                    try:
                        await ws.close(code=1008)
                    except Exception:
                        pass
                asyncio.create_task(close())
            if not loop.is_closed():
                loop.call_soon_threadsafe(close_connection)

    async def broadcast(
        self,
        message: dict,
        restaurante_id: int | None = None,
        tenant_id: int | None = None,
        target_audience: str | None = None
    ) -> None:
        """
        Envia mensagem JSON para conexões ativas do restaurante.
        target_audience:
          - "internal": apenas app de garçom, caixa, KDS (padrão para operações internas).
          - "client": apenas clientes do cardápio público.
          - "all": todas as conexões (internas e públicas).
          - None: determina automaticamente (eventos em PUBLIC_CLIENT_EVENTS -> "all", outros -> "internal").
        """
        if restaurante_id is None:
            restaurante_id = tenant_id

        if restaurante_id is None:
            try:
                from .database import current_restaurante_id
                restaurante_id = current_restaurante_id.get()
            except Exception:
                restaurante_id = None

        if not isinstance(restaurante_id, int) or isinstance(restaurante_id, bool) or restaurante_id <= 0:
            logger.warning("Broadcast ignorado: restaurante_id ausente ou inválido.")
            return

        audience = self._audience(message, target_audience)
        await self._broadcast_local(message, restaurante_id, audience)
        if self.bus:
            try:
                await asyncio.to_thread(self.bus.publish, self._envelope("broadcast", restaurante_id, message=message, audience=audience))
            except Exception as exc:
                logger.warning("Cross-process WebSocket broadcast failed: %s", type(exc).__name__)

    async def _broadcast_local(self, message: dict, restaurante_id: int, target_audience: str) -> None:
        if restaurante_id not in self.active_connections:
            return

        ctype_dict = self.active_connections[restaurante_id]
        sockets_to_send: list[WebSocket] = []

        if target_audience == "internal":
            sockets_to_send = list(ctype_dict.get("internal", []))
        elif target_audience == "client":
            sockets_to_send = list(ctype_dict.get("client", []))
        elif target_audience == "all":
            for sockets in ctype_dict.values():
                sockets_to_send.extend(sockets)
        else:
            sockets_to_send = list(ctype_dict.get("internal", []))

        if not sockets_to_send:
            return

        # Uma conexão lenta não deve atrasar todos os outros caixas, garçons e
        # cardápios do restaurante. Envia em paralelo e remove apenas os peers
        # que falharam.
        results = await asyncio.gather(
            *(
                asyncio.wait_for(connection.send_json(message), timeout=2.0)
                for connection in sockets_to_send
            ),
            return_exceptions=True,
        )
        for connection, result in zip(sockets_to_send, results):
            if isinstance(result, Exception):
                self.disconnect(connection, restaurante_id)

    def broadcast_sync(
        self,
        message: dict,
        restaurante_id: int | None = None,
        tenant_id: int | None = None,
        target_audience: str | None = None,
    ) -> None:
        """Dispara broadcast de forma segura a partir de código síncrono ou threads de worker."""
        try:
            loop = asyncio.get_running_loop()
            if loop.is_running():
                loop.create_task(self.broadcast(message, restaurante_id=restaurante_id, tenant_id=tenant_id, target_audience=target_audience))
                return
        except RuntimeError:
            pass

        rid = restaurante_id if restaurante_id is not None else tenant_id
        if rid is None:
            from .database import current_restaurante_id
            rid = current_restaurante_id.get()
        if not isinstance(rid, int) or isinstance(rid, bool) or rid <= 0:
            return
        audience = self._audience(message, target_audience)
        if self._loop and not self._loop.is_closed():
            self._loop.call_soon_threadsafe(
                lambda: asyncio.create_task(self._broadcast_local(message, rid, audience))
            )
        if self.bus:
            try:
                self.bus.publish(self._envelope("broadcast", rid, message=message, audience=audience))
            except Exception as exc:
                logger.warning("Cross-process WebSocket broadcast failed: %s", type(exc).__name__)

# Singleton instance of the connection manager
manager = ConnectionManager(shared_transport=True)
