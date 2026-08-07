"""
Servidor HTTP Localhost para Impressão Direta USB / RAW no Kôma.
Escuta em http://127.0.0.1:9123 com suporte a CORS para o Cloudflare Pages.
"""

import json
import logging
import sys
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn
from typing import Any, Dict

from adapters import get_adapter
from config import AgentConfig

log = logging.getLogger("print-agent.server")

SERVER_PORT = 9123
SERVER_HOST = "127.0.0.1"


class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    """Servidor HTTP multithread para atender requisições simultâneas sem bloquear."""
    daemon_threads = True


class KomaPrintHandler(BaseHTTPRequestHandler):
    """Manipulador de requisições HTTP do Kôma Print Server."""

    def _set_cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Koma-Token")
        self.send_header("Content-Type", "application/json; charset=utf-8")

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._set_cors_headers()
        self.end_headers()

    def do_GET(self) -> None:
        path = self.path.split("?")[0]

        if path == "/health":
            self.send_response(200)
            self._set_cors_headers()
            self.end_headers()
            response = {
                "status": "ok",
                "service": "Koma Hardware Print Agent",
                "version": "1.2.0",
                "platform": sys.platform,
                "port": SERVER_PORT,
            }
            self.wfile.write(json.dumps(response).encode("utf-8"))
            return

        if path == "/printers":
            self.send_response(200)
            self._set_cors_headers()
            self.end_headers()
            try:
                adapter = get_adapter(sys.platform)
                printers = adapter.list_printers()
            except Exception as err:
                log.error("Erro ao listar impressoras: %s", err)
                printers = []
            
            self.wfile.write(json.dumps({"printers": printers}).encode("utf-8"))
            return

        self.send_response(404)
        self._set_cors_headers()
        self.end_headers()
        self.wfile.write(json.dumps({"error": "Rota não encontrada"}).encode("utf-8"))

    def do_POST(self) -> None:
        path = self.path.split("?")[0]

        if path == "/print":
            content_length = int(self.headers.get("Content-Length", 0))
            body_data = self.rfile.read(content_length)

            try:
                payload = json.loads(body_data.decode("utf-8"))
            except Exception:
                self.send_response(400)
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"error": "JSON inválido"}).encode("utf-8"))
                return

            order_data = payload.get("order") or payload
            printer_name = payload.get("printer_name") or payload.get("printer")

            try:
                adapter = get_adapter(sys.platform)
                result = adapter.print_job(
                    job={"order": order_data, "id": order_data.get("id", "instant")},
                    printer_name=printer_name
                )
                self.send_response(200)
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": True,
                    "message": "Impressão enviada com sucesso ao Spooler RAW",
                    "details": str(result)
                }).encode("utf-8"))
            except Exception as err:
                log.error("Erro ao imprimir via HTTP local: %s", err)
                self.send_response(500)
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": False,
                    "error": str(err)
                }).encode("utf-8"))
            return

        self.send_response(404)
        self._set_cors_headers()
        self.end_headers()
        self.wfile.write(json.dumps({"error": "Rota não encontrada"}).encode("utf-8"))

    def log_message(self, format: str, *args: Any) -> None:
        # Silencia logs redundantes do HTTP server padrão
        return


def start_local_print_server(host: str = SERVER_HOST, port: int = SERVER_PORT) -> ThreadedHTTPServer:
    """Inicia o servidor HTTP local em uma thread de segundo plano."""
    server = ThreadedHTTPServer((host, port), KomaPrintHandler)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    log.info("Servidor de Impressão Direta Kôma ativo em http://%s:%d", host, port)
    return server
