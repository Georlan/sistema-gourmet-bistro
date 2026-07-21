import sys
from .base import BasePrinterAdapter

class WindowsPrinterAdapter(BasePrinterAdapter):
    """
    Adaptador para Windows Spooler (pywin32 / win32print).
    Carrega com segurança no Linux sem disparar erro se pywin32 não estiver instalado.
    """
    def __init__(self):
        self._win32print = None
        if sys.platform == "win32":
            try:
                import win32print
                self._win32print = win32print
            except ImportError:
                print("[WINDOWS ADAPTER WARNING] Módulo pywin32 não encontrado no Windows.")

    def print_ticket(self, payload_text: str, printer_name: str, doc_type: str) -> bool:
        if sys.platform != "win32" or not self._win32print:
            print(f"[WINDOWS ADAPTER MOCK] Simulação no ambiente Linux/Mock para impressora '{printer_name}'")
            return True

        try:
            win32print = self._win32print
            target_p = printer_name if printer_name and printer_name != "Padrão" else win32print.GetDefaultPrinter()
            hPrinter = win32print.OpenPrinter(target_p)
            try:
                hJob = win32print.StartDocPrinter(hPrinter, 1, ("Koma Ticket", None, "RAW"))
                win32print.StartPagePrinter(hPrinter)
                win32print.WritePrinter(hPrinter, payload_text.encode("latin-1", errors="replace"))
                win32print.EndPagePrinter(hPrinter)
                win32print.EndDocPrinter(hPrinter)
                print(f"[WINDOWS ADAPTER] Impresso com sucesso via Windows Spooler '{target_p}'")
                return True
            finally:
                win32print.ClosePrinter(hPrinter)
        except Exception as e:
            print(f"[WINDOWS ADAPTER ERROR] Erro na impressora Windows '{printer_name}': {e}")
            return False
