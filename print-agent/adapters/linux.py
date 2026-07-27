"""
Adaptador de Impressão para Linux (CUPS / Spooler / Porta Física USB).
"""

import os
import subprocess
import logging
from .base import BasePrinterAdapter
from .file import FilePrinterAdapter

log = logging.getLogger("print-agent.adapter.linux")


class LinuxPrinterAdapter(BasePrinterAdapter):
    def __init__(self, output_dir: str = "print_output"):
        self.fallback_file_adapter = FilePrinterAdapter(output_dir)

    def print_ticket(self, payload_text: str, printer_name: str, doc_type: str) -> bool:
        # 1. Se printer_name for uma porta física USB direta (/dev/usb/lp*)
        if printer_name and printer_name.startswith("/dev/"):
            if os.path.exists(printer_name):
                try:
                    with open(printer_name, "wb") as f:
                        # Tratar sequências hex para ESC/POS binário se necessário
                        data_bytes = payload_text.replace("\\x00", "\x00").encode("utf-8", errors="replace")
                        f.write(data_bytes)
                        f.write(b"\n\n\n\x1dv\x01\x00") # Comando ESC/POS de corte parcial de papel
                    log.info(f"[LINUX ADAPTER] Impresso com sucesso na porta USB '{printer_name}'")
                    return True
                except Exception as e:
                    log.error(f"[LINUX ADAPTER ERROR] Erro ao gravar na porta USB '{printer_name}': {e}")
                    return False

        # 2. Impressão via spooler CUPS (comando lp)
        try:
            cmd = ["lp"]
            if printer_name and printer_name not in ("Padrão", "auto"):
                cmd.extend(["-d", printer_name])
            
            clean_payload = payload_text.replace("\\x00", "")
            proc = subprocess.run(
                cmd,
                input=clean_payload.encode("utf-8", errors="replace"),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=10
            )
            if proc.returncode == 0:
                log.info(f"[LINUX ADAPTER] Impresso via CUPS na impressora '{printer_name}'")
                return True
            else:
                err_msg = proc.stderr.decode("utf-8", errors="replace")
                log.warning(f"[LINUX ADAPTER CUPS WARNING] {err_msg.strip()}. Recorrendo a gravação de arquivo...")
        except Exception as e:
            log.warning(f"[LINUX ADAPTER WARNING] Falha ao invocar lp/CUPS ({e}). Recorrendo a gravação de arquivo...")

        # 3. Fallback gracioso para gravação em arquivo se CUPS/Porta não responder
        return self.fallback_file_adapter.print_ticket(payload_text, printer_name, doc_type)
