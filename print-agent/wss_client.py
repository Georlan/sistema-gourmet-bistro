"""
Cliente WebSocket de Saída (WSS Outbound) para o Kôma Print Agent.
Escuta sinais de "wake_up" em tempo real vindos do backend para disparar
o claim imediato de novos print_jobs.
"""

import json
import logging
import random
import threading
import time
from typing import Optional

try:
    import websocket
except ImportError:
    websocket = None

log = logging.getLogger("print-agent.wss")


class WssWakeupClient:
    """
    Cliente WSS resiliente com autenticação por cabeçalho (Agent Token),
    reconexão automática com backoff exponencial + jitter e sinalização por Event.
    """

    def __init__(self, api_url: str, agent_token: str, wake_event: threading.Event):
        self.api_url = api_url
        self.agent_token = agent_token
        self.wake_event = wake_event
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._ws: Optional[Any] = None

        # Converter http(s):// para ws(s)://
        ws_url = api_url.replace("http://", "ws://").replace("https://", "wss://")
        if not ws_url.endswith("/"):
            ws_url += "/"
        self.ws_endpoint = f"{ws_url}ws/agent"

    def start(self) -> None:
        """Inicia a thread de escuta WSS em segundo plano."""
        if not websocket:
            log.warning("[WSS] Módulo 'websocket-client' não instalado. Mantendo modo polling padrão.")
            return

        if self._running:
            return

        self._running = True
        self._thread = threading.Thread(target=self._connection_loop, daemon=True)
        self._thread.start()
        log.info("[WSS] Cliente de Sinalização WSS inicializado em segundo plano.")

    def stop(self) -> None:
        """Encerra a conexão WSS."""
        self._running = False
        if self._ws:
            try:
                self._ws.close()
            except Exception:
                pass

    def _connection_loop(self) -> None:
        backoff = 1.0
        max_backoff = 30.0

        while self._running:
            try:
                log.info("[WSS] Conectando ao backend em %s...", self.ws_endpoint)
                
                # Autenticação via cabeçalho HTTP Handshake (nunca no token na URL)
                headers = [
                    f"X-Agent-Token: {self.agent_token}",
                    f"Authorization: Bearer {self.agent_token}",
                ]

                def on_message(ws, message):
                    nonlocal backoff
                    backoff = 1.0  # Resetar backoff após sucesso
                    try:
                        data = json.loads(message)
                        event_type = data.get("event") or data.get("type")
                        if event_type in ("print_jobs_available", "wake_up", "job_created"):
                            log.info("[WSS WAKE-UP] Notificação instantânea recebida! Disparando claim imediato.")
                            self.wake_event.set()
                    except Exception as err:
                        log.debug("[WSS] Mensagem recebida com formato ignorado: %s", err)

                def on_error(ws, error):
                    log.warning("[WSS] Aviso de conexão: %s", error)

                def on_close(ws, close_status_code, close_msg):
                    log.info("[WSS] Conexão encerrada (%s: %s).", close_status_code, close_msg)

                def on_open(ws):
                    log.info("[WSS CONECTADO] Pronto para notificações push instantâneas de impressão.")
                    # Disparar um wake-up inicial ao conectar
                    self.wake_event.set()

                self._ws = websocket.WebSocketApp(
                    self.ws_endpoint,
                    header=headers,
                    on_open=on_open,
                    on_message=on_message,
                    on_error=on_error,
                    on_close=on_close,
                )

                self._ws.run_forever(ping_interval=20, ping_timeout=10)

            except Exception as err:
                log.warning("[WSS] Falha na tentativa de conexão: %s", err)

            if not self._running:
                break

            # Backoff exponencial com jitter
            jitter = random.uniform(0, 1.0)
            sleep_time = min(backoff + jitter, max_backoff)
            log.info("[WSS RECONEXÃO] Tentando reconectar em %.1fs...", sleep_time)
            time.sleep(sleep_time)
            backoff = min(backoff * 2, max_backoff)
