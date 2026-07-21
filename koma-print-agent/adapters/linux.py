import os
import subprocess
from .base import BasePrinterAdapter

class LinuxPrinterAdapter(BasePrinterAdapter):
    """
    Adaptador para Linux. Suporta arquivo direto (/dev/usb/lp0) ou spooler CUPS (lp / lpr).
    """
    def print_ticket(self, payload_text: str, printer_name: str, doc_type: str) -> bool:
        # 1. Se printer_name for uma porta USB direta (/dev/usb/lp*)
        if printer_name and printer_name.startswith("/dev/"):
            if os.path.exists(printer_name):
                try:
                    with open(printer_name, "w", encoding="utf-8") as f:
                        f.write(payload_text)
                        f.write("\n\n\n")
                    print(f"[LINUX ADAPTER] Impresso com sucesso na porta USB '{printer_name}'")
                    return True
                except Exception as e:
                    print(f"[LINUX ADAPTER ERROR] Erro ao gravar na porta USB '{printer_name}': {e}")
                    return False

        # 2. Impressão via spooler CUPS (comando lp)
        try:
            cmd = ["lp"]
            if printer_name and printer_name != "Padrão":
                cmd.extend(["-d", printer_name])
            
            proc = subprocess.run(
                cmd,
                input=payload_text.encode("utf-8"),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=10
            )
            if proc.returncode == 0:
                print(f"[LINUX ADAPTER] Impresso via CUPS na impressora '{printer_name}'")
                return True
            else:
                err_msg = proc.stderr.decode("utf-8", errors="replace")
                print(f"[LINUX ADAPTER CUPS ERROR] {err_msg}")
        except Exception as e:
            print(f"[LINUX ADAPTER ERROR] Falha ao invocar lp/CUPS: {e}")

        return False
