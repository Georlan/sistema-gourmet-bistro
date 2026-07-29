"""
Adaptador de impressão para Linux (CUPS / porta física USB).
"""

import logging
import os
import glob
import re
import subprocess
from typing import Any, Dict, Optional

from .base import BasePrinterAdapter
from .escpos import build_escpos_payload

log = logging.getLogger("print-agent.adapter.linux")


def _run_cups_command(command: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=5,
        check=False,
    )


def _resolve_automatic_cups_printer() -> Optional[str]:
    """
    Deixa o CUPS usar seu padrão ou seleciona automaticamente a única fila.

    Retorna uma string vazia quando já existe impressora padrão, o nome da
    única fila encontrada, ou None quando não é possível escolher com segurança.
    """
    try:
        default_probe = _run_cups_command(["lpstat", "-d"])
        if default_probe.returncode == 0:
            return ""

        destinations = _run_cups_command(["lpstat", "-e"])
        if destinations.returncode != 0:
            return None
        names = [
            line.strip()
            for line in destinations.stdout.decode("utf-8", errors="replace").splitlines()
            if line.strip()
        ]
    except (OSError, subprocess.TimeoutExpired):
        return None

    if len(names) == 1:
        log.info(
            "[LINUX ADAPTER] Nenhum padrão definido; usando automaticamente '%s'.",
            names[0],
        )
        return names[0]
    if len(names) > 1:
        log.error(
            "[LINUX ADAPTER] Há várias impressoras (%s) e nenhuma padrão. "
            "Defina uma delas como padrão ou configure o destino no Kôma.",
            ", ".join(names),
        )
    return None


def _decode_command_output(proc: subprocess.CompletedProcess) -> str:
    return proc.stdout.decode("utf-8", errors="replace").strip()


def _cups_default_printer() -> Optional[str]:
    try:
        probe = _run_cups_command(["lpstat", "-d"])
    except (OSError, subprocess.TimeoutExpired):
        return None
    if probe.returncode != 0:
        return None
    output = _decode_command_output(probe)
    if ":" not in output:
        return None
    return output.rsplit(":", 1)[1].strip() or None


def _connection_from_uri(uri: str) -> str:
    normalized = (uri or "").strip().lower()
    if normalized.startswith("usb://") or "/dev/usb/" in normalized:
        return "usb"
    if normalized.startswith(
        ("socket://", "ipp://", "ipps://", "lpd://", "http://", "https://")
    ):
        return "network"
    return "unknown"


class LinuxPrinterAdapter(BasePrinterAdapter):
    def __init__(self, output_dir: str = "print_output"):
        # Mantido na assinatura por compatibilidade com a factory.
        self.output_dir = output_dir

    def get_diagnostics(self) -> Dict[str, Any]:
        """
        Detecta filas CUPS e portas USB físicas sem enviar papel.

        ``lpstat -v`` informa o URI real da fila (usb://, socket:// etc.).
        Portas /dev/usb/lp* também aparecem quando a impressora está acessível
        diretamente, mesmo sem uma fila CUPS configurada.
        """
        printers: list[dict[str, Any]] = []
        default_printer = _cups_default_printer()
        error: Optional[str] = None

        try:
            devices = _run_cups_command(["lpstat", "-v"])
            if devices.returncode == 0:
                for line in _decode_command_output(devices).splitlines():
                    match = re.match(
                        r"(?:device for|dispositivo para)\s+(.+?):\s+(.+)$",
                        line.strip(),
                        re.IGNORECASE,
                    )
                    if not match:
                        continue
                    name, uri = match.group(1).strip(), match.group(2).strip()
                    printers.append(
                        {
                            "name": name[:200],
                            "connection": _connection_from_uri(uri),
                            "uri": uri[:300],
                            "is_default": name == default_printer,
                            "available": True,
                        }
                    )
            elif devices.stderr:
                error = devices.stderr.decode(
                    "utf-8",
                    errors="replace",
                ).strip()[:300]
        except (OSError, subprocess.TimeoutExpired) as exc:
            error = f"CUPS indisponível: {exc}"[:300]

        known_uris = {str(item.get("uri")) for item in printers}
        for device_path in sorted(glob.glob("/dev/usb/lp*"))[:10]:
            if device_path in known_uris:
                continue
            printers.append(
                {
                    "name": os.path.basename(device_path),
                    "connection": "usb",
                    "uri": device_path,
                    "is_default": False,
                    "available": os.access(device_path, os.W_OK),
                }
            )

        return {
            "adapter": "linux",
            "platform": "linux",
            "printers": printers[:10],
            "default_printer": default_printer,
            "error": error,
        }

    def print_ticket(self, payload_text: str, printer_name: str, doc_type: str) -> bool:
        raw_payload = build_escpos_payload(payload_text, encoding="cp860")

        # 1. Porta física USB direta (/dev/usb/lp*).
        if printer_name and printer_name.startswith("/dev/"):
            if not os.path.exists(printer_name):
                log.error(
                    "[LINUX ADAPTER ERROR] Porta USB '%s' não encontrada.",
                    printer_name,
                )
                return False
            try:
                with open(printer_name, "wb") as printer:
                    printer.write(raw_payload)
                    printer.flush()
                log.info(
                    "[LINUX ADAPTER] Impresso com corte ESC/POS na porta USB '%s'",
                    printer_name,
                )
                return True
            except OSError as exc:
                log.error(
                    "[LINUX ADAPTER ERROR] Erro ao gravar na porta USB '%s': %s",
                    printer_name,
                    exc,
                )
                return False

        # 2. CUPS em modo RAW para preservar fonte, negrito e guilhotina.
        target_printer = printer_name
        if not target_printer or target_printer in ("Padrão", "auto"):
            target_printer = _resolve_automatic_cups_printer()
            if target_printer is None:
                log.error(
                    "[LINUX ADAPTER] Nenhuma impressora CUPS pôde ser selecionada."
                )
                return False

        cmd = ["lp"]
        if target_printer:
            cmd.extend(["-d", target_printer])
        cmd.extend(["-o", "raw"])

        try:
            proc = subprocess.run(
                cmd,
                input=raw_payload,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=10,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            log.error("[LINUX ADAPTER ERROR] Falha ao invocar lp/CUPS: %s", exc)
            return False

        if proc.returncode != 0:
            error = proc.stderr.decode("utf-8", errors="replace").strip()
            log.error("[LINUX ADAPTER CUPS ERROR] %s", error or "erro desconhecido")
            return False

        job = proc.stdout.decode("utf-8", errors="replace").strip()
        selected = target_printer or "padrão do sistema"
        log.info(
            "[LINUX ADAPTER] Trabalho enviado via CUPS RAW para '%s'%s",
            selected,
            f": {job}" if job else "",
        )
        return True
