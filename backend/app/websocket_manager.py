import logging
from fastapi import WebSocket

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
    def __init__(self) -> None:
        # Keeps track of active WebSocket connections grouped by restaurante_id and client_type
        # Structure: { restaurante_id: { "internal": [WebSocket...], "client": [WebSocket...], "agent": [WebSocket...] } }
        self.active_connections: dict[int, dict[str, list[WebSocket]]] = {}
        self.main_loop = None

    async def connect(
        self,
        websocket: WebSocket,
        restaurante_id: int,
        client_type: str = "internal"
    ) -> None:
        if not isinstance(restaurante_id, int) or isinstance(restaurante_id, bool) or restaurante_id <= 0:
            logger.warning("Conexão WebSocket rejeitada: restaurante_id ausente ou inválido.")
            try:
                await websocket.close(code=1008)
            except Exception:
                pass
            return

        try:
            self.main_loop = asyncio.get_running_loop()
        except Exception:
            pass

        await websocket.accept()

        if restaurante_id not in self.active_connections:
            self.active_connections[restaurante_id] = {"internal": [], "client": [], "agent": []}

        if client_type not in self.active_connections[restaurante_id]:
            self.active_connections[restaurante_id][client_type] = []

        self.active_connections[restaurante_id][client_type].append(websocket)
        logger.info(f"WebSocket conectado: restaurante_id={restaurante_id}, client_type={client_type}")

    def disconnect(self, websocket: WebSocket, restaurante_id: int | None = None) -> None:
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
          - "agent": apenas agentes de impressão nativos do restaurante.
          - "all": todas as conexões (internas, públicas e agentes).
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

        if restaurante_id not in self.active_connections:
            return

        # Auto-resolve target_audience if not specified
        if target_audience is None:
            event_name = message.get("event") or message.get("type") or ""
            if event_name in PUBLIC_CLIENT_EVENTS:
                target_audience = "all"
            else:
                target_audience = "internal"

        ctype_dict = self.active_connections[restaurante_id]
        sockets_to_send: list[WebSocket] = []

        if target_audience == "internal":
            sockets_to_send = list(ctype_dict.get("internal", []))
        elif target_audience == "client":
            sockets_to_send = list(ctype_dict.get("client", []))
        elif target_audience == "agent":
            sockets_to_send = list(ctype_dict.get("agent", []))
        elif target_audience == "all":
            for sockets in ctype_dict.values():
                sockets_to_send.extend(sockets)
        else:
            sockets_to_send = list(ctype_dict.get("internal", []))

        for connection in sockets_to_send:
            try:
                await connection.send_json(message)
            except Exception:
                self.disconnect(connection, restaurante_id)


# Singleton instance of the connection manager
manager = ConnectionManager()


async def notify_print_agent_jobs_available(restaurante_id: int) -> None:
    """
    Dispara notificação WSS em segundo plano para os agentes de impressão do restaurante.
    IMPORTANTE: Deve ser chamada APÓS o commit da transação no banco de dados.
    Payload seguro: {"event": "print_jobs_available"} (sem texto/dados do cupom).
    """
    if not isinstance(restaurante_id, int) or isinstance(restaurante_id, bool) or restaurante_id <= 0:
        return
    try:
        await manager.broadcast(
            {"event": "print_jobs_available"},
            restaurante_id=restaurante_id,
            target_audience="agent"
        )
    except Exception as err:
        logger.warning(f"Falha ao enviar notificação WSS de impressão para agente: {err}")


def trigger_print_agent_wakeup(restaurante_id: int) -> None:
    """
    Helper síncrono para agendar a notificação WSS de wake up do agente de impressão após o commit.
    Thread-safe: utiliza create_task se já no event loop ASGI ou run_coroutine_threadsafe se em thread.
    NUNCA usa asyncio.run() fallback (se não houver main_loop ativo, o polling 0.5s assume como fallback).
    """
    import asyncio
    if not isinstance(restaurante_id, int) or isinstance(restaurante_id, bool) or restaurante_id <= 0:
        return
    try:
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(notify_print_agent_jobs_available(restaurante_id))
        except RuntimeError:
            if manager.main_loop and manager.main_loop.is_running():
                asyncio.run_coroutine_threadsafe(
                    notify_print_agent_jobs_available(restaurante_id),
                    manager.main_loop
                )
            else:
                logger.debug(
                    "Agendamento WSS ignorado (nenhum event loop ativo). Polling assumirá o fallback."
                )
    except Exception as err:
        logger.warning(f"Falha ao agendar wake up WSS do agente: {err}")
