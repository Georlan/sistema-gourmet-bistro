"""
Adaptador de impressão para Linux (CUPS / porta física USB).
"""

import logging
import os
import glob
import re
import shutil
import socket
import subprocess
from urllib.parse import unquote, urlsplit
from typing import Any, Dict, Optional

from .base import BasePrinterAdapter
from .escpos import build_escpos_payload
from .transports import (
    PrinterTransport,
    BluetoothRfcommTransport,
    UsbDirectTransport,
    CupsTransport,
)

log = logging.getLogger("print-agent.adapter.linux")


def _run_cups_command(command: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=5,
        check=False,
    )


def _run_bluetooth_command(command: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=3,
        check=False,
    )


def _bluetooth_info_fields(output: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    for raw_line in output.splitlines():
        line = raw_line.strip()
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        fields[key.strip().casefold()] = value.strip()
    return fields


def _discover_bluetooth_spp_printers() -> list[dict[str, Any]]:
    """
    Lista dispositivos Bluetooth já conhecidos pelo BlueZ que oferecem SPP.

    Esta etapa é somente diagnóstico. Não inicia scan, não conecta dispositivos
    e não cria /dev/rfcomm*. USB/CUPS continua sendo o transporte principal.
    """
    if shutil.which("bluetoothctl") is None:
        return []

    try:
        devices_probe = _run_bluetooth_command(["bluetoothctl", "devices"])
    except (OSError, subprocess.TimeoutExpired):
        return []
    if devices_probe.returncode != 0:
        return []

    printers: list[dict[str, Any]] = []
    for raw_line in _decode_command_output(devices_probe).splitlines():
        match = re.match(
            r"^Device\s+([0-9A-Fa-f:]{17})\s+(.+)$",
            raw_line.strip(),
        )
        if not match:
            continue
        address = match.group(1).upper()
        discovered_name = match.group(2).strip()

        try:
            info_probe = _run_bluetooth_command(
                ["bluetoothctl", "info", address]
            )
        except (OSError, subprocess.TimeoutExpired):
            continue
        if info_probe.returncode != 0:
            continue

        info_text = _decode_command_output(info_probe)
        if "00001101-0000-1000-8000-00805f9b34fb" not in info_text.casefold():
            continue

        fields = _bluetooth_info_fields(info_text)
        paired = fields.get("paired", "").casefold() == "yes"
        trusted = fields.get("trusted", "").casefold() == "yes"
        connected = fields.get("connected", "").casefold() == "yes"
        name = (
            fields.get("name")
            or fields.get("alias")
            or discovered_name
            or address
        )

        # Bluetooth SPP pareado é elegível para conexão sob demanda:
        # available e present são True quando pareado, sem exigir conexão contínua.
        is_ready = bool(paired)

        printers.append(
            {
                "name": name[:200],
                "connection": "bluetooth",
                "uri": f"bluetooth://{address}",
                "address": address,
                "is_default": False,
                "available": is_ready,
                "present": is_ready,
                "configured": paired,
                "paired": paired,
                "trusted": trusted,
                "connected": connected,
                "spp": True,
            }
        )
    return printers


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
    if not names:
        direct_usb_devices = sorted(glob.glob("/dev/usb/lp*"))
        if len(direct_usb_devices) == 1 and os.access(
            direct_usb_devices[0],
            os.W_OK,
        ):
            log.info(
                "[LINUX ADAPTER] Usando diretamente a porta USB '%s'.",
                direct_usb_devices[0],
            )
            return direct_usb_devices[0]
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
    if normalized.startswith("bluetooth://"):
        return "bluetooth"
    if normalized.startswith(
        ("socket://", "ipp://", "ipps://", "lpd://", "http://", "https://")
    ):
        return "network"
    return "unknown"


def _normalize_bluetooth_address(value: str) -> str:
    raw = unquote((value or "").strip()).split("?", 1)[0]
    if "://" in raw:
        raw = raw.split("://", 1)[1]
    compact = re.sub(r"[^0-9A-Fa-f]", "", raw)
    if len(compact) != 12:
        return ""
    return ":".join(
        compact[index:index + 2].upper()
        for index in range(0, 12, 2)
    )


def _normalize_usb_uri(uri: str) -> str:
    """Normaliza URIs do CUPS, removendo serial/opções voláteis."""
    decoded = unquote((uri or "").strip()).casefold()
    return decoded.split("?", 1)[0].rstrip("/")


def _usb_uri_matches(queue_uri: str, live_uri: str) -> bool:
    queue_normalized = _normalize_usb_uri(queue_uri)
    live_normalized = _normalize_usb_uri(live_uri)
    return bool(
        queue_normalized
        and live_normalized
        and queue_normalized == live_normalized
    )


def _read_sysfs_text(path: str) -> str:
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as handle:
            return handle.read().strip()
    except OSError:
        return ""


def _discover_sysfs_usb_printers() -> list[dict[str, Any]]:
    """
    Localiza interfaces USB da classe 07 (Printer) realmente presentes.

    Diferente de ``lpstat -v``, o sysfs desaparece quando o cabo USB é
    removido. Isso evita confundir uma fila antiga do CUPS com hardware ativo.
    """
    devices: dict[str, dict[str, Any]] = {}
    interface_paths = glob.glob(
        "/sys/bus/usb/devices/*:*/bInterfaceClass"
    )
    for interface_class_path in interface_paths:
        if _read_sysfs_text(interface_class_path).casefold() not in {
            "07",
            "7",
        }:
            continue
        interface_dir = os.path.dirname(interface_class_path)
        device_id = os.path.basename(interface_dir).split(":", 1)[0]
        device_dir = os.path.join("/sys/bus/usb/devices", device_id)
        manufacturer = _read_sysfs_text(
            os.path.join(device_dir, "manufacturer")
        )
        product = _read_sysfs_text(os.path.join(device_dir, "product"))
        serial = _read_sysfs_text(os.path.join(device_dir, "serial"))
        bus_number = _read_sysfs_text(os.path.join(device_dir, "busnum"))
        device_number = _read_sysfs_text(os.path.join(device_dir, "devnum"))
        label = " ".join(
            part for part in (manufacturer, product) if part
        ).strip()
        devices[device_id] = {
            "name": (label or f"Impressora USB {device_id}")[:200],
            "connection": "usb",
            "uri": f"sysfs://usb/{device_id}",
            "is_default": False,
            "available": False,
            "present": True,
            "configured": False,
            "hardware_id": ":".join(
                part for part in (bus_number, device_number) if part
            ) or device_id,
            "serial": serial[:120] or None,
        }
    return list(devices.values())


def _sysfs_device_matches_uri(
    device: dict[str, Any],
    queue_uri: str,
) -> bool:
    normalized_uri = re.sub(
        r"[^a-z0-9]+",
        "",
        unquote(queue_uri or "").casefold(),
    )
    device_name = re.sub(
        r"[^a-z0-9]+",
        "",
        str(device.get("name") or "").casefold(),
    )
    serial = re.sub(
        r"[^a-z0-9]+",
        "",
        str(device.get("serial") or "").casefold(),
    )
    return bool(
        (serial and serial in normalized_uri)
        or (device_name and device_name in normalized_uri)
    )


def _network_printer_available(uri: str) -> bool:
    """Confirma que o endpoint de uma fila de rede aceita conexão TCP."""
    try:
        parsed = urlsplit(uri)
        if not parsed.hostname:
            return False
        default_ports = {
            "socket": 9100,
            "ipp": 631,
            "ipps": 631,
            "lpd": 515,
            "http": 80,
            "https": 443,
        }
        port = parsed.port or default_ports.get(parsed.scheme.casefold())
        if not port:
            return False
        with socket.create_connection(
            (parsed.hostname, port),
            timeout=0.75,
        ):
            return True
    except (OSError, ValueError):
        return False


def _discover_live_cups_usb_uris() -> list[str]:
    """Retorna apenas dispositivos USB presentes que o CUPS reconhece."""
    try:
        live_devices = _run_cups_command(["lpinfo", "-v"])
    except (OSError, subprocess.TimeoutExpired):
        return []
    if live_devices.returncode != 0:
        return []
    uris = []
    for line in _decode_command_output(live_devices).splitlines():
        parts = line.strip().split(maxsplit=1)
        if (
            len(parts) == 2
            and parts[1].casefold().startswith("usb://")
        ):
            uris.append(parts[1].strip())
    return list(dict.fromkeys(uris))


def _normalized_device_label(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", unquote(value or "").casefold())


def _usb_uri_matches_name(uri: str, name: str) -> bool:
    normalized_uri = _normalized_device_label(uri)
    normalized_name = _normalized_device_label(name)
    return bool(
        normalized_uri
        and normalized_name
        and (
            normalized_name in normalized_uri
            or normalized_uri in normalized_name
        )
    )


def _safe_cups_queue_name(device_name: str) -> str:
    suffix = re.sub(
        r"[^A-Za-z0-9]+",
        "_",
        unquote(device_name or ""),
    ).strip("_")
    return f"Koma_USB_{suffix or 'Termica'}"[:80]


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
        sysfs_usb_printers = _discover_sysfs_usb_printers()
        live_usb_uris = _discover_live_cups_usb_uris()

        try:
            devices = _run_cups_command(["lpstat", "-v"])
            if devices.returncode == 0:
                parsed_queues: list[tuple[str, str]] = []
                for line in _decode_command_output(devices).splitlines():
                    match = re.match(
                        r"(?:device for|dispositivo para|dispositivo de|dispositivo)\s+(.+?):\s+(.+)$",
                        line.strip(),
                        re.IGNORECASE,
                    )
                    if not match:
                        continue
                    name, uri = match.group(1).strip(), match.group(2).strip()
                    parsed_queues.append((name, uri))

                for name, uri in parsed_queues:
                    connection = _connection_from_uri(uri)
                    present = False
                    if connection == "usb":
                        present = any(
                            _usb_uri_matches(uri, live_uri)
                            for live_uri in live_usb_uris
                        ) or any(
                            _sysfs_device_matches_uri(device, uri)
                            for device in sysfs_usb_printers
                        )
                    elif connection == "network":
                        present = _network_printer_available(uri)
                    elif uri.startswith("/dev/"):
                        present = os.path.exists(uri)

                    printer_entry = {
                        "name": name[:200],
                        "connection": connection,
                        "uri": uri[:300],
                        "is_default": name == default_printer,
                        "available": present,
                        "present": present,
                        "configured": True,
                    }
                    if connection == "bluetooth":
                        printer_entry["cups_queue"] = name[:200]
                    printers.append(printer_entry)
            elif devices.stderr:
                error = devices.stderr.decode(
                    "utf-8",
                    errors="replace",
                ).strip()[:300]
        except (OSError, subprocess.TimeoutExpired) as exc:
            error = f"CUPS indisponível: {exc}"[:300]

        matched_sysfs_devices: set[str] = set()
        for device in sysfs_usb_printers:
            if any(
                printer.get("connection") == "usb"
                and printer.get("present")
                and _sysfs_device_matches_uri(device, str(printer.get("uri") or ""))
                for printer in printers
            ):
                matched_sysfs_devices.add(str(device.get("uri")))

        known_uris = {str(item.get("uri")) for item in printers}
        direct_device_paths = sorted(glob.glob("/dev/usb/lp*"))[:10]
        # Uma fila CUPS USB pronta e /dev/usb/lp0 são duas visões do mesmo
        # equipamento. A fila nomeada é o destino estável; não exponha a porta
        # RAW como uma segunda impressora no painel.
        has_ready_cups_usb = any(
            printer.get("connection") == "usb"
            and printer.get("present") is True
            and printer.get("configured") is True
            and not str(printer.get("uri") or "").startswith("/dev/")
            for printer in printers
        )
        if has_ready_cups_usb:
            direct_device_paths = []
        unmatched_sysfs = [
            device
            for device in sysfs_usb_printers
            if str(device.get("uri")) not in matched_sysfs_devices
        ]
        can_pair_direct_devices = bool(
            direct_device_paths
            and len(direct_device_paths) == len(unmatched_sysfs)
        )
        for index, device_path in enumerate(direct_device_paths):
            if device_path in known_uris:
                continue
            sysfs_device = (
                unmatched_sysfs[index]
                if can_pair_direct_devices
                else None
            )
            printers.append(
                {
                    "name": (
                        str(sysfs_device.get("name"))
                        if sysfs_device
                        else os.path.basename(device_path)
                    ),
                    "connection": "usb",
                    "uri": device_path,
                    "is_default": False,
                    "available": os.access(device_path, os.W_OK),
                    "present": True,
                    "configured": True,
                }
            )
            if sysfs_device:
                matched_sysfs_devices.add(
                    str(sysfs_device.get("uri"))
                )

        for device in sysfs_usb_printers:
            if str(device.get("uri")) in matched_sysfs_devices:
                continue
            public_device = {
                key: value
                for key, value in device.items()
                if key not in {"hardware_id", "serial"}
            }
            printers.append(public_device)

        # Bluetooth entra somente como diagnóstico nesta fase. Filas CUPS
        # bluetooth:// e a descoberta BlueZ são duas visões do mesmo hardware;
        # consolide por endereço para o painel não mostrar duplicatas.
        discovered_bluetooth = _discover_bluetooth_spp_printers()
        bluetooth_by_address = {
            str(item.get("address") or ""): item
            for item in discovered_bluetooth
            if item.get("address")
        }
        merged_bluetooth_addresses: set[str] = set()
        deduplicated_printers: list[dict[str, Any]] = []

        for printer in printers:
            if printer.get("connection") != "bluetooth":
                deduplicated_printers.append(printer)
                continue

            address = _normalize_bluetooth_address(
                str(printer.get("uri") or "")
            )
            bluez_printer = bluetooth_by_address.get(address)
            if not bluez_printer:
                deduplicated_printers.append(printer)
                continue

            merged = {
                **bluez_printer,
                "is_default": bool(printer.get("is_default")),
                "configured": bool(
                    bluez_printer.get("configured")
                    or printer.get("configured")
                ),
                "cups_queue": str(
                    printer.get("cups_queue")
                    or printer.get("name")
                    or ""
                )[:200] or None,
            }
            deduplicated_printers.append(merged)
            merged_bluetooth_addresses.add(address)
            if printer.get("is_default"):
                default_printer = str(merged.get("name") or default_printer)

        deduplicated_printers.extend(
            item
            for item in discovered_bluetooth
            if str(item.get("address") or "")
            not in merged_bluetooth_addresses
        )
        printers = deduplicated_printers

        return {
            "adapter": "linux",
            "platform": "linux",
            "printers": printers[:10],
            "default_printer": default_printer,
            "error": error,
        }

    def connect_usb(
        self,
        requested_name: str = "",
        requested_uri: str = "",
    ) -> Dict[str, Any]:
        """
        Reabre uma fila existente ou cria uma fila RAW para um USB presente.

        Nenhuma fila de rede ou virtual participa da seleção. Quando há mais
        de um USB, o painel precisa informar qual dispositivo foi escolhido.
        """
        diagnostics = self.get_diagnostics()
        usb_printers = [
            printer
            for printer in diagnostics.get("printers") or []
            if (
                isinstance(printer, dict)
                and printer.get("connection") == "usb"
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
        present_printers = [
            printer
            for printer in usb_printers
            if printer.get("present") is True
        ]
        if selected is None:
            if len(present_printers) == 1:
                selected = present_printers[0]
            elif len(present_printers) > 1:
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

        if selected and all(
            selected.get(field) is True
            for field in ("present", "configured", "available")
        ):
            selected_name = str(selected.get("name") or "")
            selected_uri = str(selected.get("uri") or "")
            if not selected_uri.startswith("/dev/") and selected_name:
                try:
                    set_default = _run_cups_command(
                        ["lpoptions", "-d", selected_name]
                    )
                except (OSError, subprocess.TimeoutExpired) as exc:
                    log.warning(
                        "[LINUX ADAPTER] Impressora pronta; não foi possível "
                        "alterar o padrão: %s",
                        exc,
                    )
                    set_default = None
                if set_default is not None and set_default.returncode != 0:
                    error = set_default.stderr.decode(
                        "utf-8",
                        errors="replace",
                    ).strip()
                    log.error(
                        "[LINUX ADAPTER] Não foi possível definir '%s' "
                        "como padrão: %s",
                        selected_name,
                        error,
                    )
                    # Definir como padrão é conveniência. A fila explícita já
                    # está pronta e continua apta a receber os trabalhos.
            return {
                "success": True,
                "code": "usb_connected",
                "message": "Impressora USB conectada e pronta para uso.",
                "printer_name": selected_name or selected_uri,
                "diagnostics": self.get_diagnostics(),
            }

        live_usb_uris = _discover_live_cups_usb_uris()
        selected_live_uri = next(
            (
                uri
                for uri in live_usb_uris
                if requested_uri and _usb_uri_matches(uri, requested_uri)
            ),
            None,
        )
        selected_name = str(
            (selected or {}).get("name")
            or requested_name
            or ""
        )
        if not selected_live_uri and selected_name:
            selected_live_uri = next(
                (
                    uri
                    for uri in live_usb_uris
                    if _usb_uri_matches_name(uri, selected_name)
                ),
                None,
            )
        if not selected_live_uri and len(live_usb_uris) == 1:
            selected_live_uri = live_usb_uris[0]

        if not selected_live_uri:
            if selected and selected.get("present") is True:
                return {
                    "success": False,
                    "code": "usb_permission_denied",
                    "message": (
                        "O USB foi detectado, mas o serviço de impressão "
                        "ainda não recebeu acesso ao dispositivo."
                    ),
                    "printer_name": selected_name or None,
                    "diagnostics": diagnostics,
                }
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

        queue_name = _safe_cups_queue_name(
            selected_name or selected_live_uri.rsplit("/", 1)[-1]
        )
        try:
            configure = _run_cups_command(
                [
                    "lpadmin",
                    "-p",
                    queue_name,
                    "-E",
                    "-v",
                    selected_live_uri,
                    "-m",
                    "raw",
                ]
            )
        except (OSError, subprocess.TimeoutExpired):
            return {
                "success": False,
                "code": "cups_unavailable",
                "message": (
                    "O Kôma encontrou o USB, mas não conseguiu acessar "
                    "o serviço de impressão."
                ),
                "printer_name": selected_name or None,
                "diagnostics": diagnostics,
            }
        if configure.returncode != 0:
            error = configure.stderr.decode(
                "utf-8",
                errors="replace",
            ).strip()
            log.error(
                "[LINUX ADAPTER] Falha ao configurar fila USB '%s': %s",
                queue_name,
                error,
            )
            return {
                "success": False,
                "code": "usb_configuration_failed",
                "message": (
                    "A impressora foi detectada, mas a configuração "
                    "automática não foi concluída."
                ),
                "printer_name": selected_name or None,
                "diagnostics": diagnostics,
            }

        try:
            _run_cups_command(["cupsenable", queue_name])
            _run_cups_command(["cupsaccept", queue_name])
            _run_cups_command(["lpoptions", "-d", queue_name])
        except (OSError, subprocess.TimeoutExpired):
            # A fila já foi criada. O diagnóstico abaixo define o resultado.
            pass

        refreshed = self.get_diagnostics()
        ready_printers = [
            printer
            for printer in refreshed.get("printers") or []
            if (
                isinstance(printer, dict)
                and printer.get("connection") == "usb"
                and printer.get("present") is True
                and printer.get("configured") is True
                and printer.get("available") is True
            )
        ]
        selected_ready = next(
            (
                printer
                for printer in ready_printers
                if printer.get("name") == queue_name
            ),
            None,
        )
        ready = bool(
            selected_ready
            and (
                selected_ready.get("is_default") is True
                or len(ready_printers) == 1
            )
        )
        return {
            "success": ready,
            "code": (
                "usb_connected"
                if ready
                else "usb_configuration_failed"
            ),
            "message": (
                "Impressora USB configurada e pronta para uso."
                if ready
                else (
                    "A fila foi criada, mas a impressora ainda não "
                    "respondeu. Reconecte o cabo e tente novamente."
                )
            ),
            "printer_name": queue_name,
            "diagnostics": refreshed,
        }

    def test_bluetooth(
        self,
        requested_name: str = "",
        requested_uri: str = "",
    ) -> Dict[str, Any]:
        """
        Envia um cupom curto pela fila CUPS Bluetooth já configurada.

        Esta ação não altera a impressora padrão do Kôma e não habilita
        PrintJobs Bluetooth. É uma bancada explícita para apresentação/teste.
        """
        diagnostics = self.get_diagnostics()
        bluetooth_printers = [
            printer
            for printer in diagnostics.get("printers") or []
            if (
                isinstance(printer, dict)
                and printer.get("connection") == "bluetooth"
            )
        ]
        requested_address = _normalize_bluetooth_address(requested_uri)
        selected = next(
            (
                printer
                for printer in bluetooth_printers
                if (
                    requested_uri
                    and str(printer.get("uri") or "") == requested_uri
                )
                or (
                    requested_address
                    and str(printer.get("address") or "") == requested_address
                )
                or (
                    requested_name
                    and str(printer.get("name") or "") == requested_name
                )
            ),
            None,
        )
        if selected is None and len(bluetooth_printers) == 1:
            selected = bluetooth_printers[0]
        if selected is None:
            return {
                "success": False,
                "code": (
                    "multiple_bluetooth_printers"
                    if len(bluetooth_printers) > 1
                    else "bluetooth_not_found"
                ),
                "message": (
                    "Há mais de uma impressora Bluetooth pareada. "
                    "Escolha qual deseja testar."
                    if len(bluetooth_printers) > 1
                    else (
                        "Nenhuma impressora Bluetooth SPP pareada foi "
                        "encontrada neste computador."
                    )
                ),
                "printer_name": None,
                "diagnostics": diagnostics,
            }

        selected_name = str(selected.get("name") or "Bluetooth")
        if selected.get("paired") is not True or selected.get("spp") is not True:
            return {
                "success": False,
                "code": "bluetooth_not_ready",
                "message": (
                    "A impressora Bluetooth foi encontrada, mas ainda não "
                    "está pareada como dispositivo serial compatível."
                ),
                "printer_name": selected_name,
                "diagnostics": diagnostics,
            }

        address = str(selected.get("address") or _normalize_bluetooth_address(str(selected.get("uri") or ""))).strip()
        if not address:
            return {
                "success": False,
                "code": "bluetooth_address_missing",
                "message": (
                    "A impressora Bluetooth está sem endereço MAC configurado."
                ),
                "printer_name": selected_name,
                "diagnostics": diagnostics,
            }

        raw_payload = build_escpos_payload(
            "KÔMA - TESTE BLUETOOTH\n"
            f"Impressora: {selected_name}\n"
            "Conexão sob demanda RFCOMM validada pelo Kôma Print.\n"
        )
        transport = BluetoothRfcommTransport(address=address, channel=1)
        if not transport.send(raw_payload):
            return {
                "success": False,
                "code": "bluetooth_test_failed",
                "message": (
                    "A impressora Bluetooth não respondeu ao teste. "
                    "Ligue a impressora e tente novamente."
                ),
                "printer_name": selected_name,
                "diagnostics": diagnostics,
            }

        return {
            "success": True,
            "code": "bluetooth_test_sent",
            "message": (
                "Teste Bluetooth enviado com sucesso. "
                "Confirme se o papel saiu na impressora."
            ),
            "printer_name": selected_name,
            "diagnostics": self.get_diagnostics(),
        }

    def resolve_transport(self, target_printer: str) -> Optional[PrinterTransport]:
        """Resolve o transporte de impressão apropriado para o destino informado."""
        target = (target_printer or "").strip()
        if not target:
            return None

        # 1. Porta USB direta (/dev/usb/lp*)
        if target.startswith("/dev/"):
            return UsbDirectTransport(device_path=target)

        # 2. URI ou MAC Bluetooth direto
        normalized_mac = _normalize_bluetooth_address(target)
        if normalized_mac:
            return BluetoothRfcommTransport(address=normalized_mac, channel=1)
        if target.startswith("bluetooth://"):
            addr = _normalize_bluetooth_address(target)
            if addr:
                return BluetoothRfcommTransport(address=addr, channel=1)

        # 3. Busca nas impressoras diagnosticadas
        diagnostics = self.get_diagnostics()
        for p in diagnostics.get("printers") or []:
            name = str(p.get("name") or "")
            uri = str(p.get("uri") or "")
            address = str(p.get("address") or "")
            queue = str(p.get("cups_queue") or "")
            if target in {name, uri, address, queue}:
                if p.get("connection") == "bluetooth" or address:
                    addr = address or _normalize_bluetooth_address(uri)
                    if addr:
                        return BluetoothRfcommTransport(address=addr, channel=1)
                if uri.startswith("/dev/"):
                    return UsbDirectTransport(device_path=uri)
                if uri.startswith("bluetooth://"):
                    addr = _normalize_bluetooth_address(uri)
                    if addr:
                        return BluetoothRfcommTransport(address=addr, channel=1)

        # 4. Fallback padrão: fila do CUPS
        return CupsTransport(queue_name=target)

    def print_ticket(
        self,
        payload_text: str,
        printer_name: str,
        doc_type: str,
        *,
        skip_ready_check: bool = False,
    ) -> bool:
        raw_payload = build_escpos_payload(payload_text, encoding="cp860")

        target_printer = printer_name
        if not target_printer or target_printer in ("Padrão", "auto"):
            diagnostics = self.get_diagnostics()
            target_printer = str(diagnostics.get("default_printer") or "").strip()
            if not target_printer:
                target_printer = _resolve_automatic_cups_printer() or ""
            if not target_printer:
                log.error(
                    "[LINUX ADAPTER] Nenhuma impressora física pronta pôde ser selecionada."
                )
                return False

        if not skip_ready_check and not self.is_printer_ready(target_printer):
            log.error(
                "[LINUX ADAPTER] A impressora '%s' está configurada, mas o "
                "equipamento físico não foi detectado.",
                target_printer or "padrão do sistema",
            )
            return False

        transport = self.resolve_transport(target_printer)
        if not transport:
            log.error(
                "[LINUX ADAPTER ERROR] Nenhum transporte disponível para '%s'.",
                target_printer,
            )
            return False

        return transport.send(raw_payload)
