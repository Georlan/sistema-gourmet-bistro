from typing import List, Dict
from fastapi import WebSocket

class ConnectionManager:
    def __init__(self):
        # Keeps track of all active WebSocket connections grouped by restaurante_id (Logical Tenant)
        self.active_connections: Dict[int, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, restaurante_id: int = 1):
        await websocket.accept()
        if restaurante_id not in self.active_connections:
            self.active_connections[restaurante_id] = []
        self.active_connections[restaurante_id].append(websocket)

    def disconnect(self, websocket: WebSocket, restaurante_id: int = 1):
        if restaurante_id in self.active_connections:
            if websocket in self.active_connections[restaurante_id]:
                self.active_connections[restaurante_id].remove(websocket)
            if not self.active_connections[restaurante_id]:
                del self.active_connections[restaurante_id]

    async def broadcast(self, message: dict, restaurante_id: int = None):
        # Dynamically resolve restaurante_id from current context if not provided
        if restaurante_id is None:
            try:
                from .database import current_restaurante_id
                restaurante_id = current_restaurante_id.get()
            except Exception:
                restaurante_id = 1
                
        if restaurante_id is None:
            restaurante_id = 1

        # Sends a JSON message only to active connections in the same restaurante_id
        if restaurante_id in self.active_connections:
            # Create a copy to prevent mutation errors during broadcast loop
            connections = list(self.active_connections[restaurante_id])
            for connection in connections:
                try:
                    await connection.send_json(message)
                except Exception:
                    # Silently ignore dead sockets; cleanup will occur on disconnect
                    pass

# Singleton instance of the connection manager
manager = ConnectionManager()
