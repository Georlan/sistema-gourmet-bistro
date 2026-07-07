from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from ..websocket_manager import manager

router = APIRouter(
    tags=["WebSocket"]
)

@router.websocket("/ws/{garcom_id}")
async def websocket_endpoint(websocket: WebSocket, garcom_id: str):
    await manager.connect(websocket)
    # Broadcast connection event to clear any stale states of this waiter on other clients
    await manager.broadcast({
        "event": "waiter_connected",
        "garcom_id": garcom_id
    })
    try:
        while True:
            # Receive json data from connected waiter client
            data = await websocket.receive_json()
            
            # If it's a draft update, broadcast it to all clients
            if data.get("action") == "draft_status":
                await manager.broadcast({
                    "event": "draft_status",
                    "mesa_id": data.get("mesa_id"),
                    "garcom_id": garcom_id,
                    "garcom_nome": data.get("garcom_nome"),
                    "ativo": data.get("ativo")
                })
    except WebSocketDisconnect:
        manager.disconnect(websocket)
        # Broadcast disconnect event so other clients can clear draft warnings for this waiter
        await manager.broadcast({
            "event": "waiter_disconnected",
            "garcom_id": garcom_id
        })
    except Exception:
        manager.disconnect(websocket)
