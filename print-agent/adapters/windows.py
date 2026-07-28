"""
Adaptador de impressão para Windows (Spooler win32print em modo RAW).
Imports são protegidos para permitir validação do módulo fora do Windows.
"""

import logging
import sys
from typing import Optional

from .base import BasePrinterAdapter
from .escpos import build_escpos_payload

log = logging.getLogger("print-agent.adapter.windows")


class WindowsPrinterAdapter(BasePrinterAdapter):
    def __init__(self, output_dir: str = "print_output"):
        self.output_dir = output_dir
        self._win32print = None
        if sys.platform == "win32":
            try:
                import win32print

                self._win32print = win32print
            except ImportError:
                log.error(
                    "[WINDOWS ADAPTER] pywin32 não está instalado; "
                    "a impressão RAW não está disponível."
                )

    def _resolve_printer(self, requested_name: str) -> Optional[str]:
        win32print = self._win32print
        if not win32print:
            return None
        if requested_name and requested_name not in ("Padrão", "auto"):
            return requested_name
        try:
            return win32print.GetDefaultPrinter()
        except Exception:
            flags = (
                win32print.PRINTER_ENUM_LOCAL
                | win32print.PRINTER_ENUM_CONNECTIONS
            )
            printers = win32print.EnumPrinters(flags)
            if len(printers) == 1:
                selected = printers[0][2]
                log.info(
                    "[WINDOWS ADAPTER] Usando automaticamente a única impressora '%s'.",
                    selected,
                )
                return selected
        return None

    def print_ticket(self, payload_text: str, printer_name: str, doc_type: str) -> bool:
        if sys.platform != "win32" or not self._win32print:
            log.error(
                "[WINDOWS ADAPTER] Spooler RAW indisponível; "
                "o trabalho não foi marcado como impresso."
            )
            return False

        target_printer = self._resolve_printer(printer_name)
        if not target_printer:
            log.error(
                "[WINDOWS ADAPTER] Nenhuma impressora padrão pôde ser selecionada."
            )
            return False

        win32print = self._win32print
        raw_bytes = build_escpos_payload(payload_text, encoding="cp860")
        printer_handle = None
        document_started = False
        page_started = False
        try:
            printer_handle = win32print.OpenPrinter(target_printer)
            win32print.StartDocPrinter(
                printer_handle,
                1,
                ("Kôma Ticket", None, "RAW"),
            )
            document_started = True
            win32print.StartPagePrinter(printer_handle)
            page_started = True
            win32print.WritePrinter(printer_handle, raw_bytes)
            win32print.EndPagePrinter(printer_handle)
            page_started = False
            win32print.EndDocPrinter(printer_handle)
            document_started = False
            log.info(
                "[WINDOWS ADAPTER] Impresso com ESC/POS e corte via Spooler RAW '%s'",
                target_printer,
            )
            return True
        except Exception as exc:
            log.error(
                "[WINDOWS ADAPTER ERROR] Erro na impressora '%s': %s",
                target_printer,
                exc,
            )
            return False
        finally:
            if printer_handle is not None:
                if page_started:
                    try:
                        win32print.EndPagePrinter(printer_handle)
                    except Exception:
                        pass
                if document_started:
                    try:
                        win32print.EndDocPrinter(printer_handle)
                    except Exception:
                        pass
                try:
                    win32print.ClosePrinter(printer_handle)
                except Exception:
                    pass
