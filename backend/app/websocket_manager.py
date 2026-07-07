from typing import List
from fastapi import WebSocket

class ConnectionManager:
    def __init__(self):
        # Keeps track of all active WebSocket connections
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        # Sends a JSON message to all connected clients
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                # Silently ignore write failures to dead sockets; 
                # they will disconnect and be cleaned up.
                pass

# Singleton instance of the connection manager
manager = ConnectionManager()
