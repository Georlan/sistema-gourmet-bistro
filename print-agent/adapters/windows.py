"""
Adaptador de impressão para Windows (Spooler win32print em modo RAW).
Imports são protegidos para permitir validação do módulo fora do Windows.
"""

import logging
import json
import re
import subprocess
import sys
from typing import Any, Dict, Optional

from .base import BasePrinterAdapter
from .escpos import build_escpos_payload

log = logging.getLogger("print-agent.adapter.windows")

VIRTUAL_PRINTER_MARKERS = (
    "microsoft print to pdf",
    "microsoft xps",
    "onenote",
    "fax",
    "adobe pdf",
    "pdfcreator",
    "pdf24",
    "cute pdf",
)
VIRTUAL_PORT_MARKERS = (
    "FILE:",
    "PORTPROMPT:",
    "SHRFAX:",
    "NUL:",
)


def _normalize_device_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (value or "").casefold())


def _is_virtual_printer(printer_name: str, port_name: str) -> bool:
    normalized_name = (printer_name or "").casefold()
    normalized_port = (port_name or "").upper()
    return any(
        marker in normalized_name
        for marker in VIRTUAL_PRINTER_MARKERS
    ) or normalized_port.startswith(VIRTUAL_PORT_MARKERS)


def _rescan_windows_usb_devices() -> None:
    """Solicita ao Plug and Play uma nova leitura sem abrir Configurações."""
    if sys.platform != "win32":
        return
    try:
        subprocess.run(
            ["pnputil.exe", "/scan-devices"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=20,
            check=False,
            text=True,
        )
    except (OSError, subprocess.TimeoutExpired):
        pass


def _windows_usb_ports() -> list[str]:
    if sys.platform != "win32":
        return []
    script = (
        "$ErrorActionPreference='Stop'; "
        "@(Get-PrinterPort | Where-Object { $_.Name -match '^USB[0-9]+:?$' } "
        "| Select-Object -ExpandProperty Name) | ConvertTo-Json -Compress"
    )
    try:
        process = subprocess.run(
            [
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                script,
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=8,
            check=False,
            text=True,
        )
    except (OSError, subprocess.TimeoutExpired):
        return []
    if process.returncode != 0 or not process.stdout.strip():
        return []
    try:
        payload = json.loads(process.stdout)
    except json.JSONDecodeError:
        return []
    if isinstance(payload, str):
        payload = [payload]
    if not isinstance(payload, list):
        return []
    return [
        str(port)
        for port in payload
        if re.fullmatch(r"USB[0-9]+:?", str(port), re.IGNORECASE)
    ]


def _install_generic_usb_queue(
    device_name: str,
) -> tuple[bool, Optional[str]]:
    """
    Cria uma fila RAW com o driver nativo Generic / Text Only.

    A operação é silenciosa quando o agente foi instalado com as permissões
    necessárias. Se o Windows negar, o painel informa que o instalador precisa
    reparar o serviço; o usuário não é enviado às Configurações do sistema.
    """
    ports = _windows_usb_ports()
    if len(ports) != 1:
        return False, None
    port_name = ports[0]
    safe_device_name = re.sub(
        r"[^A-Za-z0-9 _.-]+",
        "",
        device_name or "",
    ).strip()
    queue_name = f"Koma {safe_device_name or 'Impressora USB'}"[:80]
    script = (
        "$ErrorActionPreference='Stop'; "
        "$driver='Generic / Text Only'; "
        f"$queue='{queue_name}'; $port='{port_name}'; "
        "if (-not (Get-PrinterDriver -Name $driver -ErrorAction SilentlyContinue)) "
        "{ Add-PrinterDriver -Name $driver }; "
        "if (-not (Get-Printer -Name $queue -ErrorAction SilentlyContinue)) "
        "{ Add-Printer -Name $queue -DriverName $driver -PortName $port }; "
        "Write-Output $queue"
    )
    try:
        process = subprocess.run(
            [
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                script,
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=20,
            check=False,
            text=True,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False, None
    if process.returncode != 0:
        log.error(
            "[WINDOWS ADAPTER] Falha ao criar fila USB automática: %s",
            process.stderr.strip(),
        )
        return False, None
    return True, queue_name


def _present_windows_usb_printers() -> list[dict[str, str]]:
    """
    Consulta dispositivos USB realmente presentes via Plug and Play.

    ``EnumPrinters`` lista filas persistentes e continua retornando uma
    impressora USB desconectada. ``Get-PnpDevice -PresentOnly`` desaparece
    quando o equipamento físico é removido.
    """
    if sys.platform != "win32":
        return []
    script = (
        "$ErrorActionPreference='Stop'; "
        "@(Get-PnpDevice -PresentOnly | "
        "Where-Object { "
        "$_.InstanceId -like 'USBPRINT\\*' -or "
        "($_.Class -eq 'Printer' -and $_.InstanceId -like 'USB*') "
        "} | Select-Object FriendlyName,InstanceId,Status) | "
        "ConvertTo-Json -Compress"
    )
    try:
        process = subprocess.run(
            [
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                script,
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=6,
            check=False,
            text=True,
        )
    except (OSError, subprocess.TimeoutExpired):
        return []
    if process.returncode != 0 or not process.stdout.strip():
        return []
    try:
        payload = json.loads(process.stdout)
    except json.JSONDecodeError:
        return []
    if isinstance(payload, dict):
        payload = [payload]
    if not isinstance(payload, list):
        return []
    return [
        {
            "name": str(item.get("FriendlyName") or "Impressora USB")[:200],
            "instance_id": str(item.get("InstanceId") or "")[:300],
            "status": str(item.get("Status") or "")[:40],
        }
        for item in payload
        if isinstance(item, dict)
    ][:10]


def _matches_present_usb_device(
    printer_name: str,
    devices: list[dict[str, str]],
) -> bool:
    normalized_printer = _normalize_device_name(printer_name)
    for device in devices:
        normalized_device = _normalize_device_name(device.get("name", ""))
        if (
            normalized_printer
            and normalized_device
            and (
                normalized_printer in normalized_device
                or normalized_device in normalized_printer
            )
        ):
            return True
    return False


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
            present_usb_devices = _present_windows_usb_printers()
            matched_usb_devices: set[str] = set()
            for printer_info in win32print.EnumPrinters(flags)[:10]:
                name = printer_info[2]
                port_name = ""
                spooler_available = True
                handle = None
                try:
                    handle = win32print.OpenPrinter(name)
                    details = win32print.GetPrinter(handle, 2)
                    port_name = str(details.get("pPortName") or "")
                    status = int(details.get("Status") or 0)
                    offline_mask = int(
                        getattr(win32print, "PRINTER_STATUS_OFFLINE", 0x80)
                    )
                    error_mask = int(
                        getattr(win32print, "PRINTER_STATUS_ERROR", 0x2)
                    )
                    spooler_available = not bool(
                        status & (offline_mask | error_mask)
                    )
                except Exception:
                    spooler_available = False
                finally:
                    if handle is not None:
                        try:
                            win32print.ClosePrinter(handle)
                        except Exception:
                            pass

                if _is_virtual_printer(str(name), port_name):
                    continue

                normalized_port = port_name.upper()
                connection = (
                    "usb"
                    if normalized_port.startswith("USB")
                    else "network"
                    if normalized_port.startswith(("IP_", "WSD-", "\\\\"))
                    else "unknown"
                )
                if connection == "usb":
                    present = _matches_present_usb_device(
                        str(name),
                        present_usb_devices,
                    )
                    if (
                        not present
                        and str(name).casefold().startswith("koma ")
                        and len(present_usb_devices) == 1
                    ):
                        present = True
                    if present:
                        for device in present_usb_devices:
                            if (
                                _matches_present_usb_device(
                                    str(name),
                                    [device],
                                )
                                or (
                                    str(name).casefold().startswith("koma ")
                                    and len(present_usb_devices) == 1
                                )
                            ):
                                matched_usb_devices.add(
                                    device["instance_id"]
                                )
                else:
                    present = spooler_available

                printers.append(
                    {
                        "name": str(name)[:200],
                        "connection": connection,
                        "uri": port_name[:300] or None,
                        "is_default": name == default_printer,
                        "available": bool(present and spooler_available),
                        "present": present,
                        "configured": True,
                    }
                )

            for device in present_usb_devices:
                if device["instance_id"] in matched_usb_devices:
                    continue
                printers.append(
                    {
                        "name": device["name"],
                        "connection": "usb",
                        "uri": device["instance_id"] or None,
                        "is_default": False,
                        "available": False,
                        "present": True,
                        "configured": False,
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

    def connect_usb(
        self,
        requested_name: str = "",
        requested_uri: str = "",
    ) -> Dict[str, Any]:
        """Reescaneia o PnP, seleciona a fila física e a torna padrão."""
        if sys.platform != "win32" or not self._win32print:
            diagnostics = self.get_diagnostics()
            return {
                "success": False,
                "code": "spooler_unavailable",
                "message": (
                    "O serviço de impressão do Windows não está disponível."
                ),
                "printer_name": None,
                "diagnostics": diagnostics,
            }

        _rescan_windows_usb_devices()
        diagnostics = self.get_diagnostics()
        usb_printers = [
            printer
            for printer in diagnostics.get("printers") or []
            if (
                isinstance(printer, dict)
                and printer.get("connection") == "usb"
                and printer.get("present") is True
            )
        ]
        selected = next(
            (
                printer
                for printer in usb_printers
                if (
                    requested_uri
                    and str(printer.get("uri") or "") == requested_uri
                )
                or (
                    requested_name
                    and str(printer.get("name") or "") == requested_name
                )
            ),
            None,
        )
        if selected is None:
            if len(usb_printers) == 1:
                selected = usb_printers[0]
            elif len(usb_printers) > 1:
                return {
                    "success": False,
                    "code": "multiple_usb_printers",
                    "message": (
                        "Há mais de uma impressora USB conectada. "
                        "Escolha uma delas no painel."
                    ),
                    "printer_name": None,
                    "diagnostics": diagnostics,
                }
        if selected is None:
            return {
                "success": False,
                "code": "usb_not_found",
                "message": (
                    "Nenhuma impressora física foi encontrada no USB. "
                    "Reconecte o cabo e tente novamente."
                ),
                "printer_name": None,
                "diagnostics": diagnostics,
            }

        selected_name = str(selected.get("name") or "")
        if selected.get("configured") is not True:
            installed, queue_name = _install_generic_usb_queue(
                selected_name
            )
            if not installed or not queue_name:
                return {
                    "success": False,
                    "code": "driver_install_failed",
                    "message": (
                        "O USB foi detectado, mas o Kôma Print não conseguiu "
                        "instalar a fila automaticamente."
                    ),
                    "printer_name": selected_name or None,
                    "diagnostics": diagnostics,
                }
            selected_name = queue_name
            diagnostics = self.get_diagnostics()

        try:
            self._win32print.SetDefaultPrinter(selected_name)
            handle = self._win32print.OpenPrinter(selected_name)
            try:
                self._win32print.SetPrinter(
                    handle,
                    0,
                    None,
                    getattr(
                        self._win32print,
                        "PRINTER_CONTROL_RESUME",
                        2,
                    ),
                )
            finally:
                self._win32print.ClosePrinter(handle)
        except Exception as exc:
            log.error(
                "[WINDOWS ADAPTER] Falha ao ativar '%s': %s",
                selected_name,
                exc,
            )
            return {
                "success": False,
                "code": "usb_configuration_failed",
                "message": (
                    "A impressora foi detectada, mas não pôde ser ativada."
                ),
                "printer_name": selected_name or None,
                "diagnostics": diagnostics,
            }

        refreshed = self.get_diagnostics()
        ready = any(
            str(printer.get("name") or "") == selected_name
            and printer.get("connection") == "usb"
            and printer.get("present") is True
            and printer.get("configured") is True
            and printer.get("available") is True
            for printer in refreshed.get("printers") or []
            if isinstance(printer, dict)
        )
        return {
            "success": ready,
            "code": (
                "usb_connected"
                if ready
                else "usb_configuration_failed"
            ),
            "message": (
                "Impressora USB conectada e pronta para uso."
                if ready
                else (
                    "A impressora foi configurada, mas ainda não respondeu "
                    "ao serviço de impressão."
                )
            ),
            "printer_name": selected_name,
            "diagnostics": refreshed,
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

        if not self.is_printer_ready(target_printer):
            log.error(
                "[WINDOWS ADAPTER] A fila '%s' existe, mas a impressora "
                "física USB/rede não foi detectada.",
                target_printer,
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
