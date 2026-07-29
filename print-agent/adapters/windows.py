"""
Adaptador de impressão para Windows (Spooler win32print em modo RAW).
Imports são protegidos para permitir validação do módulo fora do Windows.
"""

import logging
import sys
from typing import Any, Dict, Optional

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

    def get_diagnostics(self) -> Dict[str, Any]:
        win32print = self._win32print
        if sys.platform != "win32" or not win32print:
            return {
                "adapter": "windows",
                "platform": "windows",
                "printers": [],
                "default_printer": None,
                "error": "Spooler do Windows ou pywin32 indisponível.",
            }

        try:
            try:
                default_printer = win32print.GetDefaultPrinter()
            except Exception:
                default_printer = None

            flags = (
                win32print.PRINTER_ENUM_LOCAL
                | win32print.PRINTER_ENUM_CONNECTIONS
            )
            printers = []
            for printer_info in win32print.EnumPrinters(flags)[:10]:
                name = printer_info[2]
                port_name = ""
                available = True
                handle = None
                try:
                    handle = win32print.OpenPrinter(name)
                    details = win32print.GetPrinter(handle, 2)
                    port_name = str(details.get("pPortName") or "")
                    status = int(details.get("Status") or 0)
                    available = status == 0
                except Exception:
                    available = False
                finally:
                    if handle is not None:
                        try:
                            win32print.ClosePrinter(handle)
                        except Exception:
                            pass

                normalized_port = port_name.upper()
                connection = (
                    "usb"
                    if normalized_port.startswith("USB")
                    else "network"
                    if normalized_port.startswith(("IP_", "WSD-", "\\\\"))
                    else "unknown"
                )
                printers.append(
                    {
                        "name": str(name)[:200],
                        "connection": connection,
                        "uri": port_name[:300] or None,
                        "is_default": name == default_printer,
                        "available": available,
                    }
                )

            return {
                "adapter": "windows",
                "platform": "windows",
                "printers": printers,
                "default_printer": default_printer,
                "error": None,
            }
        except Exception as exc:
            return {
                "adapter": "windows",
                "platform": "windows",
                "printers": [],
                "default_printer": None,
                "error": str(exc)[:300],
            }

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
