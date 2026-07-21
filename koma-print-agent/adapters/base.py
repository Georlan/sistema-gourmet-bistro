from abc import ABC, abstractmethod

class BasePrinterAdapter(ABC):
    """Classe base para todos os adaptadores de impressora do Kôma Print Agent."""

    @abstractmethod
    def print_ticket(self, payload_text: str, printer_name: str, doc_type: str) -> bool:
        """
        Envia o texto puro do ticket para a impressora física ou destino.
        Retorna True se a impressão for bem-sucedida, False se falhar.
        """
        pass
