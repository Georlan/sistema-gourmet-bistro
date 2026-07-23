import logging
from fastapi import WebSocket

logger = logging.getLogger(__name__)

class ConnectionManager:
    def __init__(self) -> None:
        # Keeps track of all active WebSocket connections grouped by restaurante_id (Logical Tenant)
        self.active_connections: dict[int, list[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, restaurante_id: int) -> None:
        if not isinstance(restaurante_id, int) or isinstance(restaurante_id, bool) or restaurante_id <= 0:
            logger.warning("Conexão WebSocket rejeitada: restaurante_id ausente ou inválido.")
            try:
                await websocket.close(code=1008)
            except Exception:
                pass
            return
        await websocket.accept()
        if restaurante_id not in self.active_connections:
            self.active_connections[restaurante_id] = []
        self.active_connections[restaurante_id].append(websocket)

    def disconnect(self, websocket: WebSocket, restaurante_id: int | None = None) -> None:
        if restaurante_id is not None and isinstance(restaurante_id, int) and not isinstance(restaurante_id, bool) and restaurante_id > 0:
            if restaurante_id in self.active_connections:
                if websocket in self.active_connections[restaurante_id]:
                    self.active_connections[restaurante_id].remove(websocket)
                if not self.active_connections[restaurante_id]:
                    del self.active_connections[restaurante_id]
        else:
            for rid, connections in list(self.active_connections.items()):
                if websocket in connections:
                    connections.remove(websocket)
                    if not connections:
                        del self.active_connections[rid]

    async def broadcast(self, message: dict, restaurante_id: int | None = None, tenant_id: int | None = None) -> None:
        if restaurante_id is None:
            restaurante_id = tenant_id
        # Dynamically resolve restaurante_id from current context if not provided

        if restaurante_id is None:
            try:
                from .database import current_restaurante_id
                restaurante_id = current_restaurante_id.get()
            except Exception:
                restaurante_id = None

        if not isinstance(restaurante_id, int) or isinstance(restaurante_id, bool) or restaurante_id <= 0:
            logger.warning("Broadcast ignorado: restaurante_id ausente ou inválido.")
            return

        # Sends a JSON message only to active connections in the same restaurante_id
        if restaurante_id in self.active_connections:
            # Create a copy to prevent mutation errors during broadcast loop
            connections = list(self.active_connections[restaurante_id])
            for connection in connections:
                try:
                    await connection.send_json(message)
                except Exception:
                    # Remove o socket morto imediatamente para evitar vazamento de memória
                    self.disconnect(connection, restaurante_id)

# Singleton instance of the connection manager
manager = ConnectionManager()

