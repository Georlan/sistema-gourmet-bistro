"""
Adaptador de Impressão para Windows (Spooler win32print modo RAW).
Imports são protegidos para que possa ser carregado e testado no Linux sem erros.
"""

import sys
import logging
from .base import BasePrinterAdapter
from .file import FilePrinterAdapter

log = logging.getLogger("print-agent.adapter.windows")


class WindowsPrinterAdapter(BasePrinterAdapter):
    def __init__(self, output_dir: str = "print_output"):
        self._win32print = None
        self.fallback_file_adapter = FilePrinterAdapter(output_dir)
        if sys.platform == "win32":
            try:
                import win32print
                self._win32print = win32print
            except ImportError:
                log.warning("[WINDOWS ADAPTER WARNING] Módulo pywin32 não instalado no Windows.")

    def print_ticket(self, payload_text: str, printer_name: str, doc_type: str) -> bool:
        if sys.platform != "win32" or not self._win32print:
            log.info(f"[WINDOWS ADAPTER MOCK] Executando em ambiente não-Windows. Redirecionando para arquivo...")
            return self.fallback_file_adapter.print_ticket(payload_text, printer_name, doc_type)

        try:
            win32print = self._win32print
            target_printer = printer_name if printer_name and printer_name not in ("Padrão", "auto") else win32print.GetDefaultPrinter()
            hPrinter = win32print.OpenPrinter(target_printer)
            try:
                hJob = win32print.StartDocPrinter(hPrinter, 1, ("Koma Ticket", None, "RAW"))
                win32print.StartPagePrinter(hPrinter)
                
                # Decodificar sequências hex de escape se houver
                raw_bytes = payload_text.replace("\\x00", "\x00").encode("latin-1", errors="replace")
                win32print.WritePrinter(hPrinter, raw_bytes)
                win32print.EndPagePrinter(hPrinter)
                win32print.EndDocPrinter(hPrinter)
                log.info(f"[WINDOWS ADAPTER] Impresso com sucesso via Spooler RAW '{target_printer}'")
                return True
            finally:
                win32print.ClosePrinter(hPrinter)
        except Exception as e:
            log.error(f"[WINDOWS ADAPTER ERROR] Erro na impressora Windows '{printer_name}': {e}")
            return False
