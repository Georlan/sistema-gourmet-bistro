"""
Interface abstrata para adaptadores de impressora por plataforma.
"""

from abc import ABC, abstractmethod
from typing import Any, Dict


class BasePrinterAdapter(ABC):
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

    @abstractmethod
    def print_ticket(self, payload_text: str, printer_name: str, doc_type: str) -> bool:
        """
        Envia o cupom para a impressora física ou destino configurado.
        Retorna True se impresso com sucesso, False caso contrário.
        """
        pass
