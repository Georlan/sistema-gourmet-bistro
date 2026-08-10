"""
Adaptador de Impressão em Arquivo (File/Development Adapter).
Útil para testes no Linux, macOS ou ambientes de desenvolvimento sem impressora física conectada.
Grava cupons legíveis em arquivos texto dentro do diretório configurado.
"""

import os
import datetime
import logging
from .base import BasePrinterAdapter

log = logging.getLogger("print-agent.adapter.file")


class FilePrinterAdapter(BasePrinterAdapter):
    requires_physical_printer = False

    def __init__(self, output_dir: str = "print_output"):
        self.output_dir = output_dir
        os.makedirs(self.output_dir, exist_ok=True)

    def get_diagnostics(self):
        return {
            "adapter": "file",
            "platform": "simulator",
            "printers": [],
            "default_printer": None,
            "error": None,
        }

    def is_printer_ready(self, requested_name: str = "Padrão") -> bool:
        # Adaptador explicitamente escolhido para desenvolvimento/simulação.
        return True

    def print_ticket(
        self,
        payload_text: str,
        printer_name: str,
        doc_type: str,
        *,
        skip_ready_check: bool = False,
    ) -> bool:
        try:
            timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S_%f")
            filename = f"ticket_{doc_type.lower()}_{timestamp}.txt"
            filepath = os.path.join(self.output_dir, filename)

            # Limpar sequências especiais ESC/POS binárias para visualização limpa em texto
            clean_text = payload_text.replace("\x00", "").replace("\x1b", "").replace("\x1d", "")

            with open(filepath, "w", encoding="utf-8") as f:
                f.write(f"================================================\n")
                f.write(f"   KÔMA BISTRÔ - SIMULADOR DE IMPRESSÃO LOCAL   \n")
                f.write(f"================================================\n")
                f.write(f"Impressora Alvo: {printer_name}\n")
                f.write(f"Tipo Documento:  {doc_type}\n")
                f.write(f"Data/Hora:       {datetime.datetime.now().strftime('%d/%m/%Y %H:%M:%S')}\n")
                f.write(f"------------------------------------------------\n\n")
                f.write(clean_text)
                f.write(f"\n\n------------------------------------------------\n")
                f.write(f"[ === CORTE DE PAPEL SIMULADO === ]\n")
                f.write(f"================================================\n")

            log.info(f"[FILE ADAPTER] Cupom '{doc_type}' impresso em arquivo: '{filepath}'")
            return True
        except Exception as e:
            log.error(f"[FILE ADAPTER ERROR] Erro ao gravar arquivo de impressão: {e}")
            return False
