"""
Adaptador de impressão para Linux (CUPS / porta física USB).
"""

import logging
import os
import subprocess

from .base import BasePrinterAdapter

log = logging.getLogger("print-agent.adapter.linux")

# ESC/POS: avança o papel e solicita corte parcial.
# GS V 66 n é amplamente suportado por impressoras térmicas com guilhotina.
PAPER_FEED = b"\n\n\n"
PARTIAL_CUT = b"\x1d\x56\x42\x00"


def build_escpos_payload(payload_text: str) -> bytes:
    """Converte o texto do cupom e acrescenta avanço/corte ESC/POS."""
    return (
        payload_text.replace("\\x00", "").encode("utf-8", errors="replace")
        + PAPER_FEED
        + PARTIAL_CUT
    )


class LinuxPrinterAdapter(BasePrinterAdapter):
    def __init__(self, output_dir: str = "print_output"):
        # Mantido na assinatura por compatibilidade com a factory.
        self.output_dir = output_dir

    def print_ticket(self, payload_text: str, printer_name: str, doc_type: str) -> bool:
        raw_payload = build_escpos_payload(payload_text)

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

        # 2. CUPS em modo RAW para preservar os comandos ESC/POS.
        cmd = ["lp"]
        if printer_name and printer_name not in ("Padrão", "auto"):
            cmd.extend(["-d", printer_name])
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
        log.info(
            "[LINUX ADAPTER] Trabalho enviado via CUPS RAW para '%s'%s",
            printer_name,
            f": {job}" if job else "",
        )
        return True
