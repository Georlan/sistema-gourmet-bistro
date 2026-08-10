"""
Interface abstrata para adaptadores de impressora por plataforma.
"""

from abc import ABC, abstractmethod
from typing import Any, Dict


class BasePrinterAdapter(ABC):
    requires_physical_printer = True

    def get_diagnostics(self) -> Dict[str, Any]:
        """
        Informa as impressoras locais sem executar uma impressão.

        Adaptadores físicos sobrescrevem este método. O resultado segue no
        heartbeat apenas para diagnóstico e não confirma saída de papel.
        """
        return {
            "adapter": self.__class__.__name__,
            "platform": "unknown",
            "printers": [],
            "default_printer": None,
            "error": None,
        }

    def is_printer_ready(self, requested_name: str = "Padrão") -> bool:
        """
        Confirma que há um equipamento físico presente e configurado.

        Uma fila cadastrada no CUPS/Spooler não basta: ``available`` só deve
        ser verdadeiro quando o adaptador confirmou a presença atual do
        equipamento. Adaptadores de simulação podem sobrescrever esta regra.
        """
        diagnostics = self.get_diagnostics()
        printers = diagnostics.get("printers") or []
        target = (requested_name or "").strip()
        automatic = not target or target.casefold() in {
            "padrão",
            "padrao",
            "default",
            "auto",
            "automática",
            "automatica",
        }
        default_printer = str(
            diagnostics.get("default_printer") or ""
        ).strip()

        for printer in printers:
            ready = bool(
                printer.get("available")
                and printer.get("present")
                and printer.get("configured")
            )
            if not ready:
                continue
            if automatic:
                if not default_printer or printer.get("is_default"):
                    return True
                if str(printer.get("name") or "") == default_printer:
                    return True
                continue
            if target in {
                str(printer.get("name") or ""),
                str(printer.get("uri") or ""),
            }:
                return True
        return False

    def connect_usb(
        self,
        requested_name: str = "",
        requested_uri: str = "",
    ) -> Dict[str, Any]:
        """
        Procura e prepara uma impressora USB física.

        Adaptadores de sistema sobrescrevem este método. O retorno é curto e
        próprio para aparecer no painel; detalhes técnicos continuam nos logs.
        """
        return {
            "success": False,
            "code": "unsupported",
            "message": (
                "Este adaptador não permite conectar impressoras USB."
            ),
            "printer_name": None,
            "diagnostics": self.get_diagnostics(),
        }

    @abstractmethod
    def print_ticket(
        self,
        payload_text: str,
        printer_name: str,
        doc_type: str,
        *,
        skip_ready_check: bool = False,
    ) -> bool:
        """
        Envia o cupom para a impressora física ou destino configurado.
        Retorna True quando o sistema operacional aceitou o trabalho.

        O worker pode usar ``skip_ready_check`` depois de validar o equipamento
        uma única vez no início do lote. Isso evita executar CUPS/PowerShell de
        novo para cada cupom sem enfraquecer a validação das chamadas isoladas.
        """
        pass
