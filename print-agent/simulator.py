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
    "https://central.komafood.com.br",
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


class AutoSimulationState:
    """Estado local e não autoritativo da bancada automática."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._enabled = False
        self._cursor: Optional[dict[str, str]] = None
        self._started_at: Optional[str] = None
        self._processed_count = 0
        self._last_event: Optional[dict[str, Any]] = None
        self._last_error: Optional[dict[str, str]] = None

    def start(self) -> dict[str, Any]:
        with self._lock:
            self._enabled = True
            self._cursor = None
            self._started_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            self._processed_count = 0
            self._last_event = None
            self._last_error = None
            return self._snapshot_unlocked()

    def stop(self) -> dict[str, Any]:
        with self._lock:
            self._enabled = False
            return self._snapshot_unlocked()

    def is_enabled(self) -> bool:
        with self._lock:
            return self._enabled

    def cursor(self) -> Optional[dict[str, str]]:
        with self._lock:
            return dict(self._cursor) if self._cursor else None

    def update_cursor(self, cursor: Any) -> None:
        if not isinstance(cursor, dict) or not cursor.get("created_at"):
            return
        with self._lock:
            self._cursor = {
                "created_at": str(cursor["created_at"]),
                "id": str(cursor.get("id") or ""),
            }

    def record(
        self,
        *,
        job: dict[str, Any],
        simulation: dict[str, Any],
        feed_request_ms: float,
    ) -> None:
        server_observed_ms = job.get("server_observed_latency_ms")
        upper_bound_ms = None
        if isinstance(server_observed_ms, (int, float)):
            upper_bound_ms = round(
                float(server_observed_ms)
                + float(feed_request_ms)
                + float(simulation.get("agent_render_ms") or 0.0),
                3,
            )
        with self._lock:
            self._processed_count += 1
            self._last_error = None
            self._last_event = {
                "job": job,
                "simulation": simulation,
                "observed": {
                    "server_observed_latency_ms": server_observed_ms,
                    "feed_request_ms": round(float(feed_request_ms), 3),
                    "virtual_ready_upper_bound_ms": upper_bound_ms,
                },
                "simulated_at": time.strftime(
                    "%Y-%m-%dT%H:%M:%SZ",
                    time.gmtime(),
                ),
            }

    def record_error(self, stage: str, message: str) -> None:
        with self._lock:
            self._last_error = {
                "stage": str(stage),
                "message": str(message),
            }

    def _snapshot_unlocked(self) -> dict[str, Any]:
        return {
            "enabled": self._enabled,
            "mode": "shadow",
            "started_at": self._started_at,
            "processed_count": self._processed_count,
            "cursor": dict(self._cursor) if self._cursor else None,
            "last_event": self._last_event,
            "last_error": self._last_error,
            "authoritative_queue_mutation": False,
            "physical_usb_write": False,
        }

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return self._snapshot_unlocked()


@dataclass
class SimulatorServer:
    server: ThreadingHTTPServer
    thread: threading.Thread
    port: int
    auto_state: AutoSimulationState

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)


def start_simulator_server(adapter_name: str) -> Optional[SimulatorServer]:
    """Sobe a ponte local na mesma faixa já autorizada pelo CSP do Kôma."""

    auto_state = AutoSimulationState()

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
            path = urlparse(self.path).path
            if path == "/simulator/auto/status":
                self._send_json(200, auto_state.snapshot())
                return
            if path != "/simulator/health":
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
                    "auto_simulation": auto_state.snapshot(),
                },
            )

        def do_POST(self) -> None:
            if self._reject_origin():
                return
            path = urlparse(self.path).path
            if path == "/simulator/auto/start":
                self._send_json(200, auto_state.start())
                return
            if path == "/simulator/auto/stop":
                self._send_json(200, auto_state.stop())
                return
            if path != "/simulator/render":
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
    return SimulatorServer(
        server=server,
        thread=thread,
        port=port,
        auto_state=auto_state,
    )
