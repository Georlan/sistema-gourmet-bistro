"""Servidor local de simulação ESC/POS do Kôma Print Agent.

A simulação é deliberadamente local e read-only: usa o mesmo builder de bytes
que os adapters Linux/Windows, mas nunca escreve no CUPS, Spooler ou /dev/usb.
"""

from __future__ import annotations

import json
import logging
import sys
import threading
import time
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Optional
from urllib.parse import urlparse

from adapters.escpos import build_escpos_payload

log = logging.getLogger("print-agent.simulator")

SIMULATOR_PORT_START = 17654
SIMULATOR_PORT_END = 17664
MAX_REQUEST_BYTES = 128 * 1024
MAX_PAYLOAD_CHARS = 64 * 1024

EXACT_ALLOWED_ORIGINS = {
    "https://app.komafood.com.br",
    "https://sistema-gourmet-bistro.pages.dev",
}
LOCAL_ALLOWED_PORTS = {3000, 4173, 4283}


def _origin_allowed(origin: str) -> bool:
    if not origin:
        return True
    if origin in EXACT_ALLOWED_ORIGINS:
        return True
    try:
        parsed = urlparse(origin)
    except ValueError:
        return False
    return (
        parsed.scheme == "http"
        and parsed.hostname in {"127.0.0.1", "localhost"}
        and parsed.port in LOCAL_ALLOWED_PORTS
    )


def _command(offset: int, raw: bytes, name: str, detail: str) -> dict[str, Any]:
    return {
        "offset": offset,
        "hex": raw.hex(" ").upper(),
        "name": name,
        "detail": detail,
    }


def _style_snapshot(state: dict[str, Any]) -> dict[str, Any]:
    return {
        "font": state["font"],
        "bold": state["bold"],
        "double_height": state["double_height"],
        "line_spacing_dots": state["line_spacing_dots"],
    }


def parse_escpos_payload(raw_payload: bytes) -> dict[str, Any]:
    """Interpreta somente os comandos ESC/POS que o Kôma emite hoje.

    Comandos desconhecidos aparecem no trace, mas não são convertidos em uma
    suposição visual. Isso mantém a ferramenta honesta diante de firmware/modelos
    diferentes.
    """

    state: dict[str, Any] = {
        "font": "A",
        "bold": False,
        "double_height": False,
        "line_spacing_dots": None,
    }
    lines: list[dict[str, Any]] = [{"runs": []}]
    commands: list[dict[str, Any]] = []
    unknown_commands: list[dict[str, Any]] = []

    def append_text(text: str) -> None:
        if not text:
            return
        snapshot = _style_snapshot(state)
        runs = lines[-1]["runs"]
        if runs and all(runs[-1].get(key) == value for key, value in snapshot.items()):
            runs[-1]["text"] += text
        else:
            runs.append({"text": text, **snapshot})

    i = 0
    text_buffer = bytearray()

    def flush_text() -> None:
        nonlocal text_buffer
        if text_buffer:
            append_text(bytes(text_buffer).decode("cp860", errors="replace"))
            text_buffer = bytearray()

    while i < len(raw_payload):
        byte = raw_payload[i]

        if byte == 0x0A:
            flush_text()
            commands.append(_command(i, raw_payload[i : i + 1], "LF", "avanço de linha"))
            lines.append({"runs": []})
            i += 1
            continue

        if byte == 0x0D:
            flush_text()
            commands.append(_command(i, raw_payload[i : i + 1], "CR", "retorno de carro"))
            i += 1
            continue

        if byte == 0x1B:
            flush_text()
            if raw_payload[i : i + 2] == b"\x1b@":
                state.update(font="A", bold=False, double_height=False, line_spacing_dots=None)
                commands.append(_command(i, raw_payload[i : i + 2], "ESC @", "inicializar impressora"))
                i += 2
                continue

            if i + 2 < len(raw_payload) and raw_payload[i + 1] == 0x74:
                value = raw_payload[i + 2]
                detail = "selecionar tabela de caracteres PC860" if value == 3 else f"selecionar tabela de caracteres {value}"
                commands.append(_command(i, raw_payload[i : i + 3], "ESC t", detail))
                i += 3
                continue

            if i + 2 < len(raw_payload) and raw_payload[i + 1] == 0x4D:
                value = raw_payload[i + 2]
                state["font"] = "B" if value == 1 else "A"
                commands.append(_command(i, raw_payload[i : i + 3], "ESC M", f"fonte {state['font']}"))
                i += 3
                continue

            if i + 2 < len(raw_payload) and raw_payload[i + 1] == 0x45:
                value = raw_payload[i + 2]
                state["bold"] = value != 0
                commands.append(_command(i, raw_payload[i : i + 3], "ESC E", "negrito ligado" if state["bold"] else "negrito desligado"))
                i += 3
                continue

            if i + 2 < len(raw_payload) and raw_payload[i + 1] == 0x21:
                value = raw_payload[i + 2]
                state["double_height"] = bool(value & 0x10)
                commands.append(_command(i, raw_payload[i : i + 3], "ESC !", f"modo de caractere 0x{value:02X}"))
                i += 3
                continue

            if i + 2 < len(raw_payload) and raw_payload[i + 1] == 0x33:
                value = raw_payload[i + 2]
                state["line_spacing_dots"] = value
                commands.append(_command(i, raw_payload[i : i + 3], "ESC 3", f"espaçamento entre linhas: {value} dots"))
                i += 3
                continue

            item = _command(i, raw_payload[i : i + 1], "ESC ?", "sequência ESC não reconhecida pelo simulador")
            commands.append(item)
            unknown_commands.append(item)
            i += 1
            continue

        if byte == 0x1D:
            flush_text()
            if raw_payload[i : i + 4] == b"\x1d\x56\x42\x00":
                commands.append(_command(i, raw_payload[i : i + 4], "GS V", "corte parcial"))
                i += 4
                continue
            item = _command(i, raw_payload[i : i + 1], "GS ?", "sequência GS não reconhecida pelo simulador")
            commands.append(item)
            unknown_commands.append(item)
            i += 1
            continue

        text_buffer.append(byte)
        i += 1

    flush_text()
    while len(lines) > 1 and not lines[-1]["runs"]:
        lines.pop()

    return {
        "lines": lines,
        "commands": commands,
        "unknown_commands": unknown_commands,
    }


def simulate_payload(payload_text: str) -> dict[str, Any]:
    if not isinstance(payload_text, str):
        raise ValueError("payload_text precisa ser texto.")
    if len(payload_text) > MAX_PAYLOAD_CHARS:
        raise ValueError(f"payload_text excede o limite de {MAX_PAYLOAD_CHARS} caracteres.")

    started_ns = time.perf_counter_ns()
    raw_payload = build_escpos_payload(payload_text, encoding="cp860")
    parsed = parse_escpos_payload(raw_payload)
    render_ns = time.perf_counter_ns() - started_ns

    return {
        "protocol": "ESC/POS RAW",
        "encoding": "cp860",
        "payload_characters": len(payload_text),
        "raw_byte_count": len(raw_payload),
        "raw_hex": raw_payload.hex(" ").upper(),
        "agent_render_ms": round(render_ns / 1_000_000, 3),
        "physical_print_time_ms": None,
        "physical_completion_tracking": False,
        **parsed,
    }


@dataclass
class SimulatorServer:
    server: ThreadingHTTPServer
    thread: threading.Thread
    port: int

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)


def start_simulator_server(adapter_name: str) -> Optional[SimulatorServer]:
    """Sobe a ponte local na mesma faixa já autorizada pelo CSP do Kôma."""

    class SimulatorHandler(BaseHTTPRequestHandler):
        server_version = "KomaPrintSimulator/1"

        def _cors(self) -> None:
            origin = self.headers.get("Origin", "")
            if origin and _origin_allowed(origin):
                self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Cache-Control", "no-store")

        def _send_json(self, status_code: int, payload: dict[str, Any]) -> None:
            encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status_code)
            self._cors()
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        def _reject_origin(self) -> bool:
            origin = self.headers.get("Origin", "")
            if origin and not _origin_allowed(origin):
                self._send_json(
                    403,
                    {
                        "error": {
                            "stage": "origin_validation",
                            "code": "origin_not_allowed",
                            "message": "Origem não autorizada a acessar o simulador local.",
                        }
                    },
                )
                return True
            return False

        def do_OPTIONS(self) -> None:
            if self._reject_origin():
                return
            self.send_response(204)
            self._cors()
            self.end_headers()

        def do_GET(self) -> None:
            if self._reject_origin():
                return
            if self.path != "/simulator/health":
                self._send_json(404, {"error": {"stage": "routing", "code": "not_found", "message": "Endpoint local não encontrado."}})
                return
            self._send_json(
                200,
                {
                    "status": "ready",
                    "service": "koma-print-simulator",
                    "protocol": "ESC/POS RAW",
                    "encoding": "cp860",
                    "adapter": adapter_name,
                    "platform": sys.platform,
                    "transport": {
                        "kind": "virtual",
                        "physical_usb_write": False,
                        "physical_printer_required": False,
                    },
                },
            )

        def do_POST(self) -> None:
            if self._reject_origin():
                return
            if self.path != "/simulator/render":
                self._send_json(404, {"error": {"stage": "routing", "code": "not_found", "message": "Endpoint local não encontrado."}})
                return
            try:
                content_length = int(self.headers.get("Content-Length", "0"))
                if content_length <= 0 or content_length > MAX_REQUEST_BYTES:
                    raise ValueError("Corpo da requisição ausente ou acima do limite local.")
                request_data = json.loads(self.rfile.read(content_length).decode("utf-8"))
                payload_text = request_data.get("payload_text")
                result = simulate_payload(payload_text)
                self._send_json(200, result)
            except (ValueError, TypeError, json.JSONDecodeError) as exc:
                self._send_json(
                    400,
                    {
                        "error": {
                            "stage": "request_validation",
                            "code": "invalid_simulation_request",
                            "message": str(exc),
                        }
                    },
                )
            except Exception:
                log.exception("[SIMULADOR] Falha ao converter payload ESC/POS.")
                self._send_json(
                    500,
                    {
                        "error": {
                            "stage": "escpos_render",
                            "code": "simulation_failed",
                            "message": "Falha ao converter o payload usando o pipeline ESC/POS local.",
                        }
                    },
                )

        def log_message(self, format: str, *args: Any) -> None:
            return

    server: Optional[ThreadingHTTPServer] = None
    port = 0
    for candidate in range(SIMULATOR_PORT_START, SIMULATOR_PORT_END + 1):
        try:
            server = ThreadingHTTPServer(("127.0.0.1", candidate), SimulatorHandler)
            port = candidate
            break
        except OSError:
            continue

    if server is None:
        log.error(
            "[SIMULADOR] Nenhuma porta local livre entre %s e %s.",
            SIMULATOR_PORT_START,
            SIMULATOR_PORT_END,
        )
        return None

    thread = threading.Thread(
        target=server.serve_forever,
        name="koma-print-simulator",
        daemon=True,
    )
    thread.start()
    log.info(
        "[SIMULADOR] Ponte local ESC/POS disponível em http://127.0.0.1:%s.",
        port,
    )
    return SimulatorServer(server=server, thread=thread, port=port)
