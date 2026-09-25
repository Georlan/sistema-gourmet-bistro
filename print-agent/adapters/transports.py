"""
Camada de transporte de impressão do Kôma Print.
Desacopla o envio de bytes do spooler/SO, permitindo canais Bluetooth RFCOMM,
USB direto, CUPS e Spooler sob uma mesma interface funcional.
"""

from abc import ABC, abstractmethod
import logging
import os
import re
import socket
import subprocess
import sys
import time
from typing import Optional

log = logging.getLogger("print-agent.transports")


class PrinterTransport(ABC):
    """Contrato básico de transporte de impressão."""

    @abstractmethod
    def send(self, data: bytes) -> bool:
        """
        Transmite o payload bruto e encerra o canal de forma limpa.
        Retorna True se o envio foi aceito/concluído com sucesso.
        """
        pass

    @abstractmethod
    def is_available(self) -> bool:
        """Verifica se o transporte está disponível e operacional."""
        pass


# Constantes de protocolo Bluetooth caso o CPython tenha sido compilado sem cabeçalhos BlueZ
AF_BLUETOOTH_LINUX = getattr(socket, "AF_BLUETOOTH", 31)
BTPROTO_RFCOMM_LINUX = getattr(socket, "BTPROTO_RFCOMM", 3)
AF_BTH_WINDOWS = 32
BTHPROTO_RFCOMM_WINDOWS = 3


class BluetoothRfcommTransport(PrinterTransport):
    """
    Transporte Bluetooth Classic SPP via RFCOMM.

    Opera sob demanda:
    - Abre o socket apenas no momento do envio do job.
    - Conecta no canal RFCOMM (canal 1 por padrão).
    - Envia em chunks (padrão 512 bytes) com pausa entre chunks (~10ms)
      para não saturar o buffer serial da impressora.
    - Fecha o socket no bloco finally garantido.
    - Não depende de /dev/rfcomm*, sudo, CUPS ou conexão contínua.
    """

    def __init__(
        self,
        address: str,
        channel: int = 1,
        timeout: float = 10.0,
        chunk_size: int = 512,
        chunk_delay_s: float = 0.010,
        socket_factory=None,
    ):
        self.address = self.normalize_address(address)
        self.channel = int(channel)
        self.timeout = float(timeout)
        self.chunk_size = int(chunk_size)
        self.chunk_delay_s = float(chunk_delay_s)
        self._socket_factory = socket_factory

    @staticmethod
    def normalize_address(value: str) -> str:
        """Normaliza endereços MAC Bluetooth para o formato XX:XX:XX:XX:XX:XX."""
        raw = (value or "").strip().split("?", 1)[0]
        if "://" in raw:
            raw = raw.split("://", 1)[1]
        compact = re.sub(r"[^0-9A-Fa-f]", "", raw)
        if len(compact) != 12:
            return value.strip().upper()
        return ":".join(compact[i:i + 2].upper() for i in range(0, 12, 2))

    def is_available(self) -> bool:
        """Verifica se o endereço é válido e o transporte é suportado na plataforma."""
        if not self.address or len(self.address.replace(":", "")) != 12:
            return False
        if sys.platform.startswith("linux") or sys.platform == "win32":
            return True
        return False

    def send(self, data: bytes) -> bool:
        if not data:
            return True
        if not self.address:
            log.error("[BT RFCOMM] Endereço Bluetooth não informado.")
            return False

        if sys.platform.startswith("linux") or self._socket_factory is not None:
            return self._send_rfcomm_socket(data)
        elif sys.platform == "win32":
            return self._send_windows_rfcomm(data)
        else:
            log.error("[BT RFCOMM] Plataforma não suportada: %s", sys.platform)
            return False

    def _create_socket(self):
        if self._socket_factory:
            return self._socket_factory()
        return socket.socket(AF_BLUETOOTH_LINUX, socket.SOCK_STREAM, BTPROTO_RFCOMM_LINUX)

    def _send_rfcomm_socket(self, data: bytes) -> bool:
        sock = None
        try:
            sock = self._create_socket()
            sock.settimeout(self.timeout)
            sock.connect((self.address, self.channel))

            total_bytes = len(data)
            for offset in range(0, total_bytes, self.chunk_size):
                chunk = data[offset:offset + self.chunk_size]
                sock.sendall(chunk)
                if self.chunk_delay_s > 0 and (offset + self.chunk_size < total_bytes):
                    time.sleep(self.chunk_delay_s)

            log.info(
                "[BT RFCOMM] Enviados %d bytes com sucesso para %s (canal %d)",
                len(data),
                self.address,
                self.channel,
            )
            return True
        except (socket.timeout, TimeoutError) as exc:
            log.error(
                "[BT RFCOMM TIMEOUT] Tempo esgotado ao comunicar com %s: %s",
                self.address,
                exc,
            )
            return False
        except (ConnectionRefusedError, ConnectionResetError) as exc:
            log.error(
                "[BT RFCOMM REFUSED] Conexão recusada por %s: %s",
                self.address,
                exc,
            )
            return False
        except OSError as exc:
            log.error(
                "[BT RFCOMM ERROR] Falha no transporte RFCOMM para %s: %s",
                self.address,
                exc,
            )
            return False
        except Exception as exc:
            log.error(
                "[BT RFCOMM UNEXPECTED] Erro inesperado no transporte para %s: %s",
                self.address,
                exc,
            )
            return False
        finally:
            if sock is not None:
                try:
                    sock.close()
                except Exception:
                    pass

    def _send_windows_rfcomm(self, data: bytes) -> bool:
        """
        Implementação do transporte RFCOMM no Windows.
        Tenta Winsock AF_BTH (32) / BTHPROTO_RFCOMM (3).
        """
        if hasattr(socket, "AF_BLUETOOTH") and hasattr(socket, "BTPROTO_RFCOMM"):
            return self._send_rfcomm_socket(data)

        AF_BTH = 32
        BTHPROTO_RFCOMM = 3
        sock = None
        try:
            sock = socket.socket(AF_BTH, socket.SOCK_STREAM, BTHPROTO_RFCOMM)
            sock.settimeout(self.timeout)
            sock.connect((self.address, self.channel))
            total_bytes = len(data)
            for offset in range(0, total_bytes, self.chunk_size):
                chunk = data[offset:offset + self.chunk_size]
                sock.sendall(chunk)
                if self.chunk_delay_s > 0 and (offset + self.chunk_size < total_bytes):
                    time.sleep(self.chunk_delay_s)
            return True
        except (OSError, ValueError) as exc:
            log.error("[BT RFCOMM WINDOWS] Falha ao enviar via Winsock RFCOMM: %s", exc)
            return False
        finally:
            if sock is not None:
                try:
                    sock.close()
                except Exception:
                    pass


class UsbDirectTransport(PrinterTransport):
    """Transporte para gravação direta em dispositivo de caractere USB (/dev/usb/lp*)."""

    def __init__(self, device_path: str):
        self.device_path = device_path

    def is_available(self) -> bool:
        import os
        return os.path.exists(self.device_path) and os.access(self.device_path, os.W_OK)

    def send(self, data: bytes) -> bool:
        if not data:
            return True
        try:
            with open(self.device_path, "wb") as handle:
                handle.write(data)
                handle.flush()
            log.info("[USB DIRECT] Impresso com sucesso na porta '%s'", self.device_path)
            return True
        except OSError as exc:
            log.error("[USB DIRECT ERROR] Erro ao gravar em '%s': %s", self.device_path, exc)
            return False


class CupsTransport(PrinterTransport):
    """Transporte para envio através do spooler CUPS via comando lp -o raw."""

    def __init__(self, queue_name: str, timeout: float = 15.0):
        self.queue_name = queue_name
        self.timeout = timeout

    def is_available(self) -> bool:
        return bool(self.queue_name)

    def send(self, data: bytes) -> bool:
        if not data:
            return True
        import subprocess
        cmd = ["lp"]
        if self.queue_name:
            cmd.extend(["-d", self.queue_name])
        cmd.extend(["-o", "raw"])
        try:
            proc = subprocess.run(
                cmd,
                input=data,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=self.timeout,
                check=False,
            )
            if proc.returncode != 0:
                error = proc.stderr.decode("utf-8", errors="replace").strip()
                log.error("[CUPS TRANSPORT ERROR] %s", error or "erro desconhecido")
                return False
            job = proc.stdout.decode("utf-8", errors="replace").strip()
            log.info(
                "[CUPS TRANSPORT] Trabalho enviado para '%s'%s",
                self.queue_name,
                f": {job}" if job else "",
            )
            return True
        except (OSError, subprocess.TimeoutExpired) as exc:
            log.error("[CUPS TRANSPORT ERROR] Falha ao invocar lp: %s", exc)
            return False


class WindowsSpoolerTransport(PrinterTransport):
    """Transporte para envio através do Spooler do Windows (win32print RAW)."""

    def __init__(self, printer_name: str):
        self.printer_name = printer_name

    def is_available(self) -> bool:
        return bool(self.printer_name)

    def send(self, data: bytes) -> bool:
        if not data:
            return True
        try:
            import win32print  # type: ignore
        except ImportError:
            log.error("[WINDOWS SPOOLER] win32print não está disponível.")
            return False
        handle = None
        try:
            handle = win32print.OpenPrinter(self.printer_name)
            win32print.StartDocPrinter(handle, 1, ("Koma Print Job", None, "RAW"))
            win32print.StartPagePrinter(handle)
            win32print.WritePrinter(handle, data)
            win32print.EndPagePrinter(handle)
            win32print.EndDocPrinter(handle)
            return True
        except Exception as exc:
            log.error(
                "[WINDOWS SPOOLER ERROR] Falha ao imprimir em '%s': %s",
                self.printer_name,
                exc,
            )
            return False
        finally:
            if handle:
                try:
                    win32print.ClosePrinter(handle)
                except Exception:
                    pass
