"""Pareamento local do Kôma Print Agent sem cópia manual de token."""

import json
import os
import secrets
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Optional
from urllib.parse import urlencode


KOMA_WEB_URL = os.getenv(
    "KOMA_WEB_URL",
    "https://sistema-gourmet-bistro.pages.dev/",
)
ALLOWED_ORIGIN = "https://sistema-gourmet-bistro.pages.dev"


def credentials_path() -> Path:
    if os.name == "nt":
        base = Path(os.getenv("APPDATA", Path.home()))
        return base / "Koma" / "PrintAgent" / "credentials.json"
    return Path.home() / ".config" / "koma-print-agent" / "credentials.json"


def load_stored_token() -> str:
    path = credentials_path()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        token = str(data.get("agent_token", "")).strip()
        return token if token.startswith("koma_ag_") else ""
    except (OSError, ValueError, TypeError):
        return ""


def clear_stored_token() -> None:
    """Remove somente a credencial já rejeitada; fila e journal são preservados."""

    try:
        credentials_path().unlink(missing_ok=True)
    except OSError:
        # O processo ainda encerra sem martelar a API. O próximo instalador
        # poderá substituir o arquivo manualmente se o SO bloquear a remoção.
        pass


def save_stored_token(token: str) -> None:
    path = credentials_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"agent_token": token}, ensure_ascii=False),
        encoding="utf-8",
    )
    if os.name != "nt":
        os.chmod(path, 0o600)


def pair_agent(timeout_seconds: int = 180) -> Optional[str]:
    """Abre o Kôma e recebe a credencial autorizada via localhost."""
    nonce = secrets.token_urlsafe(32)
    completed = threading.Event()
    state = {"token": ""}

    class PairingHandler(BaseHTTPRequestHandler):
        def _cors(self) -> None:
            origin = self.headers.get("Origin", "")
            if origin == ALLOWED_ORIGIN:
                self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Private-Network", "true")

        def do_OPTIONS(self) -> None:
            self.send_response(204)
            self._cors()
            self.end_headers()

        def do_POST(self) -> None:
            if self.path != "/pair":
                self.send_error(404)
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                payload = json.loads(self.rfile.read(length).decode("utf-8"))
                token = str(payload.get("token", "")).strip()
                received_nonce = str(payload.get("nonce", ""))
                if (
                    not secrets.compare_digest(received_nonce, nonce)
                    or not token.startswith("koma_ag_")
                ):
                    self.send_response(403)
                    self._cors()
                    self.end_headers()
                    return
                save_stored_token(token)
                state["token"] = token
                self.send_response(204)
                self._cors()
                self.end_headers()
                completed.set()
            except (OSError, ValueError, TypeError):
                self.send_response(400)
                self._cors()
                self.end_headers()

        def log_message(self, format: str, *args) -> None:
            return

    server = None
    for port in range(17654, 17665):
        try:
            server = ThreadingHTTPServer(("127.0.0.1", port), PairingHandler)
            break
        except OSError:
            continue
    if server is None:
        return None

    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    query = urlencode(
        {
            "view": "caixa",
            "pair_print_agent": nonce,
            "agent_port": port,
        }
    )
    webbrowser.open(f"{KOMA_WEB_URL}?{query}")
    print("[PAREAMENTO] Autorize este computador na janela do Kôma que foi aberta.")
    completed.wait(timeout_seconds)
    server.shutdown()
    server.server_close()
    return state["token"] or None
