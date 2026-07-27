"""
Interface abstrata para adaptadores de impressora por plataforma.
"""

from abc import ABC, abstractmethod


class BasePrinterAdapter(ABC):
    @abstractmethod
    def print_ticket(self, payload_text: str, printer_name: str, doc_type: str) -> bool:
        """
        Envia o cupom para a impressora física ou destino configurado.
        Retorna True se impresso com sucesso, False caso contrário.
        """
        pass
