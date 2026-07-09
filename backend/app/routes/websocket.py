from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import jwt
from ..config import settings
from ..websocket_manager import manager

router = APIRouter(
    tags=["WebSocket"]
)

@router.websocket("/ws/{garcom_id}")
async def websocket_endpoint(websocket: WebSocket, garcom_id: str, token: str = None):
    # Dynamically extract and decode claims to find the restaurante_id
    restaurante_id = 1
    if token:
        try:
            payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
            restaurante_id = int(payload.get("restaurante_id", 1))
        except Exception:
            pass

    await manager.connect(websocket, restaurante_id)
    
    # Broadcast connection event to clear any stale states of this waiter on other clients
    await manager.broadcast({
        "event": "waiter_connected",
        "garcom_id": garcom_id
    }, restaurante_id)
    
    try:
        while True:
            # Receive json data from connected waiter client
            data = await websocket.receive_json()
            
            # If it's a draft update, broadcast it to other clients in the same restaurant
            if data.get("action") == "draft_status":
                await manager.broadcast({
                    "event": "draft_status",
                    "mesa_id": data.get("mesa_id"),
                    "garcom_id": garcom_id,
                    "garcom_nome": data.get("garcom_nome"),
                    "ativo": data.get("ativo")
                }, restaurante_id)
    except WebSocketDisconnect:
        manager.disconnect(websocket, restaurante_id)
        # Broadcast disconnect event so other clients can clear draft warnings for this waiter
        await manager.broadcast({
            "event": "waiter_disconnected",
            "garcom_id": garcom_id
        }, restaurante_id)
    except Exception:
        manager.disconnect(websocket, restaurante_id)
