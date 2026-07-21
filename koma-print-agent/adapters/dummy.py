import os
import datetime
from .base import BasePrinterAdapter

class DummyPrinterAdapter(BasePrinterAdapter):
    """
    Adaptador Dummy para testes sem impressora física.
    Grava o documento em disco no diretório 'dummy_jobs'.
    """
    def __init__(self, output_dir: str = "dummy_jobs"):
        self.output_dir = output_dir
        os.makedirs(self.output_dir, exist_ok=True)

    def print_ticket(self, payload_text: str, printer_name: str, doc_type: str) -> bool:
        ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        filename = f"job_{doc_type.lower()}_{ts}.txt"
        filepath = os.path.join(self.output_dir, filename)

        with open(filepath, "w", encoding="utf-8") as f:
            f.write(f"=== DUMMY PRINT JOB [{doc_type}] ===\n")
            f.write(f"Printer: {printer_name}\n")
            f.write(f"Timestamp: {datetime.datetime.now().isoformat()}\n")
            f.write("----------------------------------------\n")
            f.write(payload_text)
            f.write("\n----------------------------------------\n")

        print(f"[DUMMY ADAPTER] Ticket gravado com sucesso em: {filepath}")
        return True
