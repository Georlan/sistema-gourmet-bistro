import os
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
import jwt

from ..config import settings, normalize_cors_origin
from ..database import SessionLocal, current_restaurante_id
from ..security import _authenticated_user_from_token
from ..websocket_manager import manager

router = APIRouter(
    tags=["WebSocket"]
)


def _validated_internal_websocket_identity(token: str, requested_user_id: str):
    """Resolve a identidade canônica do socket interno e falha fechado.

    O caminho `/ws/{garcom_id}` é legado e continua existindo por compatibilidade,
    mas nunca pode escolher a identidade operacional. A identidade vem do JWT e
    é revalidada no banco para que troca de cargo, desativação ou remoção da conta
    tenha efeito também em novas conexões WebSocket.
    """
    payload = jwt.decode(
        token,
        settings.SECRET_KEY,
        algorithms=[settings.ALGORITHM],
    )
    token_user_id = str(payload.get("sub") or "").strip()
    restaurante_id_raw = payload.get("restaurante_id")

    if not token_user_id or not requested_user_id or token_user_id != requested_user_id:
        raise ValueError("Identidade do WebSocket diverge do token autenticado.")
    if (
        not isinstance(restaurante_id_raw, int)
        or isinstance(restaurante_id_raw, bool)
        or restaurante_id_raw <= 0
    ):
        raise ValueError("Tenant inválido no token do WebSocket.")

    restaurante_id = int(restaurante_id_raw)
    tenant_token = current_restaurante_id.set(restaurante_id)
    db = SessionLocal(restaurante_id=restaurante_id)
    try:
        user = _authenticated_user_from_token(token, db)
        if str(user.id) != token_user_id:
            raise ValueError("Identidade autenticada inconsistente.")
        return restaurante_id, str(user.id), str(user.nome or "Operador")
    finally:
        db.close()
        current_restaurante_id.reset(tenant_token)


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
    Aceita restaurante_id numérico. Exige restaurante_id válido.
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

    if not token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    try:
        restaurante_id_val, authenticated_user_id, authenticated_user_name = (
            _validated_internal_websocket_identity(token, garcom_id)
        )
    except (jwt.PyJWTError, ValueError, Exception):
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await manager.connect(websocket, restaurante_id_val, client_type="internal")

    await manager.broadcast({
        "event": "waiter_connected",
        "garcom_id": authenticated_user_id,
    }, restaurante_id_val, target_audience="internal")

    try:
        while True:
            data = await websocket.receive_json()

            if data.get("action") != "draft_status":
                continue

            mesa_id = data.get("mesa_id")
            ativo = data.get("ativo")
            if (
                not isinstance(mesa_id, int)
                or isinstance(mesa_id, bool)
                or mesa_id <= 0
                or not isinstance(ativo, bool)
            ):
                continue

            await manager.broadcast({
                "event": "draft_status",
                "mesa_id": mesa_id,
                "garcom_id": authenticated_user_id,
                "garcom_nome": authenticated_user_name,
                "ativo": ativo,
            }, restaurante_id_val, target_audience="internal")
    except WebSocketDisconnect:
        manager.disconnect(websocket, restaurante_id_val)
        await manager.broadcast({
            "event": "waiter_disconnected",
            "garcom_id": authenticated_user_id,
        }, restaurante_id_val, target_audience="internal")
    except Exception:
        manager.disconnect(websocket, restaurante_id_val)
