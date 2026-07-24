from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
import jwt
from ..config import settings
from ..websocket_manager import manager

router = APIRouter(
    tags=["WebSocket"]
)

@router.websocket("/ws/{garcom_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    garcom_id: str,
    token: str = None,
):
    # Token obrigatório: sem token, fechar a conexão imediatamente
    if not token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        restaurante_id_raw = payload.get("restaurante_id")
        # Rejeitar tokens sem restaurante_id válido (None, 0 ou ausente)
        if not restaurante_id_raw:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
        restaurante_id_val = int(restaurante_id_raw)
    except jwt.ExpiredSignatureError:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    except jwt.PyJWTError:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    except Exception:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await manager.connect(websocket, restaurante_id_val)

    # Broadcast connection event to clear any stale states of this waiter on other clients
    await manager.broadcast({
        "event": "waiter_connected",
        "garcom_id": garcom_id
    }, restaurante_id_val)

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
                }, restaurante_id_val)
    except WebSocketDisconnect:
        manager.disconnect(websocket, restaurante_id_val)
        # Broadcast disconnect event so other clients can clear draft warnings for this waiter
        await manager.broadcast({
            "event": "waiter_disconnected",
            "garcom_id": garcom_id
        }, restaurante_id_val)
    except Exception:
        manager.disconnect(websocket, restaurante_id_val)


@router.websocket("/ws/cliente")
async def websocket_cliente_endpoint(
    websocket: WebSocket,
    restaurante_id: str = "1"
):
    """
    WebSocket endpoint público para clientes do Cardápio Digital.
    Aceita restaurante_id como int ou slug string (ex: '1', 'burger').
    """
    restaurante_id_val = 1
    if restaurante_id:
        try:
            restaurante_id_val = int(restaurante_id)
        except ValueError:
            restaurante_id_val = 1

    await manager.connect(websocket, restaurante_id_val)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket, restaurante_id_val)
    except Exception:
        manager.disconnect(websocket, restaurante_id_val)

