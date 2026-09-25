"""
Modelos estruturados de endpoints e resolução de destinos do Kôma Print.
Desacopla a identificação física/lógica de impressoras de meros nomes de fila.
"""

from dataclasses import dataclass, field
import re
from typing import Any, Dict, List, Optional
import uuid

from adapters.transports import (
    PrinterTransport,
    BluetoothRfcommTransport,
    UsbDirectTransport,
    CupsTransport,
    WindowsSpoolerTransport,
    TcpTransport,
)

SUPPORTED_TRANSPORTS = {
    "bluetooth_rfcomm",
    "cups",
    "usb_direct",
    "windows_spooler",
    "tcp",
}


def infer_transport_from_target(target: str, platform: str = "linux") -> tuple[str, str]:
    """
    Infere o transporte e o endereço a partir de uma string de destino legado.
    Retorna (transport, address).
    """
    raw = (target or "").strip()
    if not raw:
        return "cups" if platform.startswith("linux") else "windows_spooler", ""

    # Bluetooth URI ou MAC
    if raw.startswith("bluetooth://"):
        norm_mac = BluetoothRfcommTransport.normalize_address(raw)
        return "bluetooth_rfcomm", norm_mac or raw
    compact = re.sub(r"[^0-9A-Fa-f]", "", raw)
    if len(compact) == 12 and (":" in raw or "-" in raw or len(raw) == 12):
        return "bluetooth_rfcomm", BluetoothRfcommTransport.normalize_address(raw)

    # Dispositivo direto USB
    if raw.startswith("/dev/"):
        return "usb_direct", raw

    # TCP / Rede
    if raw.startswith("tcp://") or raw.startswith("socket://"):
        addr = raw.split("://", 1)[1]
        return "tcp", addr
    if re.match(r"^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$", raw):
        return "tcp", raw

    # Spooler padrão por SO
    if platform == "win32":
        return "windows_spooler", raw
    return "cups", raw


@dataclass
class PrinterEndpoint:
    """
    Representação estruturada de um endpoint de impressão.

    Campos:
    - id: identificador único estável (ex: 'ep-g250-usb', 'ep-ka1445-bt')
    - name: nome identificador ou fila da impressora
    - display_name: nome amigável para exibição
    - transport: meio de transporte ('bluetooth_rfcomm', 'cups', 'usb_direct', 'windows_spooler', 'tcp')
    - address: endereço físico/lógico (MAC, /dev/usb/lp*, fila CUPS/Spooler, IP:porta)
    - protocol: protocolo de impressão ('escpos', 'raw')
    - options: opções específicas do transporte (ex: canal, timeout, chunk_size)
    """

    id: str = ""
    name: str = ""
    display_name: str = ""
    transport: str = "cups"
    address: str = ""
    protocol: str = "escpos"
    options: Dict[str, Any] = field(default_factory=dict)

    def __post_init__(self):
        clean_transport = (self.transport or "cups").strip().lower()
        if clean_transport not in SUPPORTED_TRANSPORTS:
            clean_transport = "cups"
        self.transport = clean_transport

        if not self.name and self.address:
            self.name = self.address
        elif not self.name:
            self.name = "Impressora"

        if not self.display_name:
            self.display_name = self.name

        if not self.id:
            safe_name = re.sub(r"[^a-zA-Z0-9_-]+", "-", self.name).strip("-").lower()
            self.id = f"ep-{self.transport}-{safe_name}" if safe_name else f"ep-{uuid.uuid4().hex[:8]}"

        if not self.address:
            self.address = self.name

        if not self.protocol:
            self.protocol = "escpos"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "display_name": self.display_name,
            "transport": self.transport,
            "address": self.address,
            "protocol": self.protocol,
            "options": dict(self.options),
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "PrinterEndpoint":
        return cls(
            id=str(data.get("id") or ""),
            name=str(data.get("name") or data.get("display_name") or ""),
            display_name=str(data.get("display_name") or data.get("name") or ""),
            transport=str(data.get("transport") or "").strip().lower(),
            address=str(data.get("address") or data.get("uri") or ""),
            protocol=str(data.get("protocol") or "escpos").strip().lower(),
            options=dict(data.get("options") or {}),
        )

    def build_transport(self) -> Optional[PrinterTransport]:
        """Instancia o PrinterTransport correspondente a este endpoint."""
        t = self.transport
        opts = self.options or {}

        if t == "bluetooth_rfcomm":
            norm_addr = BluetoothRfcommTransport.normalize_address(self.address)
            return BluetoothRfcommTransport(
                address=norm_addr or self.address,
                channel=int(opts.get("channel", 1)),
                timeout=float(opts.get("timeout", 10.0)),
                chunk_size=int(opts.get("chunk_size", 512)),
                chunk_delay_s=float(opts.get("chunk_delay_s", 0.010)),
            )
        elif t == "usb_direct":
            return UsbDirectTransport(device_path=self.address)
        elif t == "cups":
            return CupsTransport(
                queue_name=self.address or self.name,
                timeout=float(opts.get("timeout", 15.0)),
            )
        elif t == "windows_spooler":
            return WindowsSpoolerTransport(printer_name=self.address or self.name)
        elif t == "tcp":
            host = self.address
            port = int(opts.get("port", 9100))
            if ":" in host:
                parts = host.split(":", 1)
                host = parts[0]
                try:
                    port = int(parts[1])
                except ValueError:
                    pass
            return TcpTransport(
                host=host,
                port=port,
                timeout=float(opts.get("timeout", 10.0)),
            )
        return None
