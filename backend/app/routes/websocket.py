import os
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
import jwt
from ..config import settings, normalize_cors_origin
from ..websocket_manager import manager

router = APIRouter(
    tags=["WebSocket"]
)

async def validate_websocket_origin(websocket: WebSocket) -> bool:
    """
    Valida a origem da conexão WebSocket contra a allowlist configurada.
    - Origem presente e autorizada: aceita.
    - Origem presente e não autorizada: encerra com WS_1008_POLICY_VIOLATION.
    - Origem ausente: em produção, encerra com WS_1008_POLICY_VIOLATION por padrão.
      Em ambiente de desenvolvimento/teste ou com WEBSOCKET_ALLOW_MISSING_ORIGIN=true, autoriza.
    Registra apenas a origem sanitizada (nunca tokens, query params ou dados de usuário).
    """
    raw_origin = websocket.headers.get("origin") or websocket.headers.get("Origin")
    allowed_origins = settings.get_cors_allowed_origins()
    
    if raw_origin:
        try:
            clean_origin = normalize_cors_origin(raw_origin)
        except RuntimeError:
            logging.getLogger("koma.websocket").warning(
                "[WEBSOCKET BLOQUEADO] Cabeçalho Origin malformado."
            )
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return False

        if clean_origin not in allowed_origins:
            logging.getLogger("koma.websocket").warning(
                f"[WEBSOCKET BLOQUEADO] Origem não autorizada: {clean_origin}"
            )
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return False
        return True
    else:
        # Origem ausente
        env = os.getenv("ENVIRONMENT", "production").lower()
        if env in ("development", "test") or settings.WEBSOCKET_ALLOW_MISSING_ORIGIN:
            return True
            
        logging.getLogger("koma.websocket").warning(
            "[WEBSOCKET BLOQUEADO] Conexão sem cabeçalho Origin rejeitada em produção."
        )
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return False

@router.websocket("/ws/cliente")
async def websocket_cliente_endpoint(
    websocket: WebSocket,
    restaurante_id: str = None
):
    """
    WebSocket endpoint público para clientes do Cardápio Digital.
    Aceita restaurante_id como int ou slug string. Exige restaurante_id válido.
    Registra conexão com client_type="client" para receber apenas eventos públicos.
    """
    if not await validate_websocket_origin(websocket):
        return

    if not restaurante_id:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    restaurante_id_val = None
    try:
        restaurante_id_val = int(restaurante_id)
    except ValueError:
        pass

    if not restaurante_id_val or restaurante_id_val <= 0:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await manager.connect(websocket, restaurante_id_val, client_type="client")
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket, restaurante_id_val)
    except Exception:
        manager.disconnect(websocket, restaurante_id_val)


@router.websocket("/ws/{garcom_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    garcom_id: str,
    token: str = None,
):
    if not await validate_websocket_origin(websocket):
        return

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

    # Registra a conexão interna do app de garçom/caixa com client_type="internal"
    await manager.connect(websocket, restaurante_id_val, client_type="internal")

    # Broadcast connection event (apenas para audiência interna)
    await manager.broadcast({
        "event": "waiter_connected",
        "garcom_id": garcom_id
    }, restaurante_id_val, target_audience="internal")

    try:
        while True:
            # Receive json data from connected waiter client
            data = await websocket.receive_json()

            # If it's a draft update, broadcast it to other internal clients in the same restaurant
            if data.get("action") == "draft_status":
                await manager.broadcast({
                    "event": "draft_status",
                    "mesa_id": data.get("mesa_id"),
                    "garcom_id": garcom_id,
                    "garcom_nome": data.get("garcom_nome"),
                    "ativo": data.get("ativo")
                }, restaurante_id_val, target_audience="internal")
    except WebSocketDisconnect:
        manager.disconnect(websocket, restaurante_id_val)
        # Broadcast disconnect event to internal clients only
        await manager.broadcast({
            "event": "waiter_disconnected",
            "garcom_id": garcom_id
        }, restaurante_id_val, target_audience="internal")
    except Exception:
        manager.disconnect(websocket, restaurante_id_val)


@router.websocket("/ws/agent")
async def websocket_agent_endpoint(
    websocket: WebSocket
):
    """
    WebSocket dedicado para Kôma Print Agents nativos.
    Autenticação por máquina via X-Agent-Token ou Authorization: Bearer <token>.
    Isolamento estrito de tenant (restaurante_id).
    Registra conexão com client_type="agent".
    """
    import hashlib
    from ..database import SessionLocal
    from ..models import PrintAgentToken

    # Extrair token do cabeçalho X-Agent-Token ou Authorization
    raw_token = websocket.headers.get("x-agent-token") or websocket.headers.get("X-Agent-Token")
    if not raw_token:
        auth_header = websocket.headers.get("authorization") or websocket.headers.get("Authorization")
        if auth_header:
            parts = auth_header.split()
            if len(parts) == 2 and parts[0].lower() == "bearer":
                raw_token = parts[1]

    if not raw_token:
        logging.getLogger("koma.websocket").warning(
            "[WEBSOCKET AGENTE REJEITADO] Token de agente ausente nos cabeçalhos."
        )
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    computed_hash = hashlib.sha256(raw_token.strip().encode("utf-8")).hexdigest()

    # Validar token no banco de dados
    db = SessionLocal()
    try:
        agent = db.query(PrintAgentToken).filter(
            PrintAgentToken.token_hash == computed_hash,
            PrintAgentToken.ativo == True
        ).first()

        if not agent or not agent.restaurante_id:
            logging.getLogger("koma.websocket").warning(
                "[WEBSOCKET AGENTE REJEITADO] Token de agente inválido ou revogado."
            )
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        restaurante_id_val = int(agent.restaurante_id)
    finally:
        db.close()

    # Registra conexão nativa do agente com client_type="agent"
    await manager.connect(websocket, restaurante_id_val, client_type="agent")

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket, restaurante_id_val)
    except Exception:
        manager.disconnect(websocket, restaurante_id_val)

