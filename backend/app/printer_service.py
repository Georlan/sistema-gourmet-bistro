import os
import datetime
import textwrap
import secrets
from typing import List, Optional
from .config import settings

def align_left(text: str, width: int) -> str:
    return text.ljust(width)[:width]

def align_right(text: str, width: int) -> str:
    return text.rjust(width)[:width]

def align_center(text: str, width: int) -> str:
    return text.center(width)[:width]

def split_justified(left_text: str, right_text: str, width: int) -> str:
    available = width - len(right_text)
    if available <= 0:
        return (left_text + right_text)[:width]
    return left_text.ljust(available)[:available] + right_text

def draw_separator(char: str = "-", width: int = 40) -> str:
    return char * width

# AJUSTADO: Função utilitária segura para buscar chaves/atributos em dicts ou objetos SQLAlchemy
def safe_get(obj, key, default=""):
    if obj is None:
        return default
    if isinstance(obj, dict):
        val = obj.get(key, default)
        return val if val is not None else default
    val = getattr(obj, key, default)
    return val if val is not None else default

def format_item_line(name: str, qty: int, price_unit: float, width: int = 40) -> str:
    # Use full name without abbreviations — wrap if needed
    qty_str = f"{qty}x"
    price_str = f"{price_unit:.2f}"
    total_str = f"{(qty * price_unit):.2f}"
    
    # Wrap product name if it exceeds 21 characters
    name_lines = textwrap.wrap(name, width=21)
    
    # First line has all columns
    first_name = name_lines[0] if name_lines else ""
    line = first_name.ljust(21) + qty_str.rjust(4) + price_str.rjust(7) + total_str.rjust(8)
    
    # Subsequent lines only have wrapped name
    for extra in name_lines[1:]:
        line += "\n" + extra.ljust(21)
        
    return line


def format_kitchen_item(qty: int, name: str, observation: str = "", client_name: str = "", width: int = 40, preco_unit: float = 0.0) -> str:
    # Use full product name — no abbreviations; wrap if necessary
    qty_str = f"{qty}x"
    
    # Build main item line with price column if price is provided
    if preco_unit > 0:
        total = qty * preco_unit
        price_col = f"R${total:.2f}"
        # Name area = width - qty (3) - space (1) - price_col - space (1)
        name_width = width - len(qty_str) - 1 - len(price_col) - 1
        name_trunc = name[:name_width].ljust(name_width)
        header = f"{qty_str} {name_trunc} {price_col}"
    else:
        header = f"{qty_str} {name}"
    
    if observation:
        obs_clean = observation.replace("\n", " | ").replace(", ", " | ")
        obs_lines = textwrap.wrap(f"  * {obs_clean}", width=width)
        return header + "\n" + "\n".join(obs_lines)
        
    return header

class PrinterService:
    """
    Serviço de impressão com fila persistente em disco.
    
    Fluxo:
      1. Job é salvo em disco imediatamente (garante que nunca é perdido)
      2. Tentativa de impressão imediata
      3. Se falhar: job fica em 'failed/' para retry posterior
      4. retry_failed_jobs() pode ser chamado manualmente ou em agendamento
    """
    
    FAILED_DIR = "failed"
    MAX_RETRIES = 3

    def __init__(self):
        self.width = settings.PRINTER_WIDTH
        self.jobs_dir = settings.PRINT_JOBS_DIR
        self.simulate = settings.SIMULATE_PRINTER
        # Ensure directories exist
        os.makedirs(self.jobs_dir, exist_ok=True)
        os.makedirs(os.path.join(self.jobs_dir, self.FAILED_DIR), exist_ok=True)

    def _persist_job(self, doc_type: str, content: str) -> str:
        """Salva o job em disco antes de tentar imprimir. Garante que nada é perdido."""
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"job_{doc_type}_{timestamp}_{secrets.token_hex(4)}.txt"
        filepath = os.path.join(self.jobs_dir, filename)
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(content)
        return filepath

    def _mark_failed(self, filepath: str):
        """Move job para a pasta de falhas para retry posterior."""
        filename = os.path.basename(filepath)
        failed_path = os.path.join(self.jobs_dir, self.FAILED_DIR, filename)
        try:
            os.rename(filepath, failed_path)
            print(f"[PRINT QUEUE] Job movido para falhas: {failed_path}")
        except Exception as e:
            print(f"[PRINT QUEUE] Erro ao mover job para falhas: {e}")

    def _mark_done(self, filepath: str):
        """Remove job da fila após impressão bem-sucedida."""
        try:
            if os.path.exists(filepath):
                os.remove(filepath)
        except Exception as e:
            print(f"[PRINT QUEUE] Erro ao remover job concluído: {e}")

    def _print_raw(self, content: str) -> bool:
        """
        Envia conteúdo raw para a impressora física.
        Retorna True se OK, False se falhar.
        """
        try:
            if os.name == 'posix':
                device_path = "/dev/usb/lp0"
                with open(device_path, "wb") as f:
                    f.write(b"\x1b@")          # Initialize ESC @
                    f.write(b"\x1bt\x10")       # Select cp858/Latin-1
                    f.write(content.encode('cp1252', errors='replace'))
                    f.write(b"\n\n\x1dV\x42\x00")  # Feed + cut
                print(f"[PRINTER] Impresso com sucesso via USB {device_path}")
                return True
            else:
                import win32print
                hPrinter = win32print.OpenPrinter(settings.PRINTER_NAME)
                try:
                    win32print.StartDocPrinter(hPrinter, 1, (f"Koma Print", None, "RAW"))
                    win32print.StartPagePrinter(hPrinter)
                    raw = b"\x1b@\x1bt\x10" + content.encode('cp1252', errors='replace') + b"\n\n\x1d\x56\x42\x00"
                    win32print.WritePrinter(hPrinter, raw)
                    win32print.EndPagePrinter(hPrinter)
                    win32print.EndDocPrinter(hPrinter)
                finally:
                    win32print.ClosePrinter(hPrinter)
                print(f"[PRINTER] Impresso com sucesso via '{settings.PRINTER_NAME}'")
                return True
        except Exception as e:
            print(f"[PRINTER] Falha de hardware: {e}")
            return False

    def send_to_printer(self, doc_type: str, content: str):
        """
        Ponto de entrada principal. 
        - Em modo simulação: persiste em disco e retorna.
        - Em modo real: persiste em disco PRIMEIRO, depois imprime.
          Se impressora falhar, job fica em /failed para retry.
        """
        filepath = self._persist_job(doc_type, content)

        if self.simulate:
            print(f"[PRINTER SIMULATION] Job '{doc_type}' salvo em: {filepath}")
            return filepath

        # Modo real: tenta imprimir; falha → fica na fila de retry
        success = self._print_raw(content)
        if success:
            self._mark_done(filepath)
        else:
            self._mark_failed(filepath)
            print(f"[PRINT QUEUE] Job '{doc_type}' aguardando retry em: {filepath}")
        
        return filepath

    def retry_failed_jobs(self, max_retries: int = MAX_RETRIES):
        """
        Tenta reimprimir todos os jobs na pasta /failed.
        Chame isso manualmente ou via endpoint de admin quando a impressora voltar.
        """
        failed_dir = os.path.join(self.jobs_dir, self.FAILED_DIR)
        if not os.path.exists(failed_dir):
            return {"retried": 0, "success": 0, "still_failed": 0}

        jobs = [f for f in os.listdir(failed_dir) if f.endswith(".txt")]
        success_count = 0
        still_failed = 0

        for job_file in jobs:
            job_path = os.path.join(failed_dir, job_file)
            try:
                with open(job_path, "r", encoding="utf-8") as f:
                    content = f.read()
                
                ok = self._print_raw(content)
                if ok:
                    os.remove(job_path)
                    success_count += 1
                    print(f"[RETRY] Job '{job_file}' reimpresso com sucesso.")
                else:
                    still_failed += 1
                    print(f"[RETRY] Job '{job_file}' ainda falhou.")
            except Exception as e:
                still_failed += 1
                print(f"[RETRY] Erro ao processar job '{job_file}': {e}")

        return {
            "retried": len(jobs),
            "success": success_count,
            "still_failed": still_failed
        }

    def get_queue_status(self) -> dict:
        """Retorna status da fila de impressão (para endpoint de admin)."""
        failed_dir = os.path.join(self.jobs_dir, self.FAILED_DIR)
        pending = len([f for f in os.listdir(self.jobs_dir) if f.endswith(".txt")]) if os.path.exists(self.jobs_dir) else 0
        failed = len([f for f in os.listdir(failed_dir) if f.endswith(".txt")]) if os.path.exists(failed_dir) else 0
        return {
            "pending_jobs": pending,
            "failed_jobs": failed,
            "simulate_mode": self.simulate,
            "jobs_dir": self.jobs_dir
        }


    def generate_kitchen_ticket(self, num_pedido: int, tipo: str, mesa_id: Optional[int], garcom_nome: str, items: list, is_reprint: bool = False) -> str:
        width = self.width
        lines = []
        
        # Comandos de controle de fonte e espaçamento ESC/POS embutidos como string
        TIGHT_LINE = "\x1b3\x18"  # Espaçamento curto entre linhas (24 dots em vez de 30)
        FONT_A = "\x1bM\x00"      # Fonte normal (mais legível para cozinha)
        FONT_B = "\x1bM\x01"      # Fonte condensada pequena (para economizar papel)
        BOLD_ON = "\x1bE\x01"     # Ativa Negrito
        BOLD_OFF = "\x1bE\x00"    # Desativa Negrito
        
        # Inicia com espaçamento curto de linha e muda para Fonte B para o cabeçalho
        lines.append(TIGHT_LINE + FONT_B)
        
        # Se o garçom não fez o pedido, por padrão vira "CONSUMO LOCAL"
        order_type = (tipo or "CONSUMO LOCAL").upper()
        if not garcom_nome or garcom_nome.strip() == "" or garcom_nome.lower() == "caixa":
            order_type = "CONSUMO LOCAL"
            
        mesa_str = f" | MESA: {mesa_id}" if mesa_id is not None else ""
        reprint_str = "[REIMPRESSÃO] " if is_reprint else ""
        
        # Cabeçalho unificado e compacto de 2 linhas
        lines.append(f"{reprint_str}[{order_type}]{mesa_str} | PEDIDO: #{num_pedido}")
        
        garcom_str = garcom_nome.upper() if garcom_nome else "CAIXA"
        data_hora = datetime.datetime.now().strftime("%d/%m %H:%M")
        lines.append(f"GARCOM: {garcom_str} | {data_hora}")
        
        # Um único traço fino de divisão abaixo do cabeçalho
        lines.append("-" * 40)
        
        # 1. Agrupa os itens idênticos da comanda por (codigo, nome, observacao, cliente_nome) de forma 100% segura
        grouped = {}
        for item in items:
            if safe_get(item, "status") == "cancelado":
                continue
                
            nome = safe_get(item, "nome") or safe_get(safe_get(item, "produto"), "nome") or ""
            codigo = safe_get(item, "codigo") or safe_get(safe_get(item, "produto"), "id") or ""
            obs = str(safe_get(item, "observacao") or "").strip()
            cliente = str(safe_get(item, "cliente_nome") or safe_get(item, "cliente_nome_custom") or "").strip()
            
            key = (codigo, nome, obs, cliente)
            if key not in grouped:
                grouped[key] = 0
            grouped[key] += int(safe_get(item, "quantidade") or 1)

        # 2. Altera para Fonte A Negrito para os itens de comida ficarem bem legíveis
        lines.append(FONT_A + BOLD_ON)
        
        # 3. Varre os itens agrupados gerando o cupom condensado
        for (codigo, nome, obs, cliente), quantidade in grouped.items():
            cod_str = f" {codigo} -" if codigo else ""
            cliente_str = f" [{cliente.upper()}]" if cliente else ""
            
            # Linha principal do item
            item_line = f"{quantidade}x{cod_str} {nome}{cliente_str}"
            lines.append(item_line)
            
            # Observações em Fonte B (pequena e sem negrito) embaixo do item
            if obs:
                lines.append(BOLD_OFF + FONT_B)
                lines.append(f"   * {obs}")
                lines.append(FONT_A + BOLD_ON)  # Retorna ao estilo dos itens
                
        lines.append(BOLD_OFF)  # Desativa o negrito para o rodapé
        
        # Um único traço e rodapé em Fonte B
        lines.append(FONT_B)
        lines.append("-" * 40)
        lines.append(align_center("KÔMA BISTRÔ", width))
        
        # Adiciona marcador de corte em simulação
        if self.simulate:
            lines.append("\n" + align_center("[CUT]", width) + "\n")
            
        return "\n".join(lines)

    def generate_receipt(self, num_pedido: int, tipo: str, mesa_id: Optional[int], garcom_nome: str, comandas_details: list, print_header: Optional[str] = None, print_footer: Optional[str] = None, taxa_servico_ativa: bool = True, taxa_servico_padrao: float = 10.0, apenas_valores: bool = False) -> str:
        width = self.width
        lines = []
        
        # Header
        lines.append(draw_separator("=", width))
        lines.append(align_center("*** CONFERÊNCIA DE CONSUMO ***", width))
        header_text = print_header if print_header else "KÔMA GOURMET BISTRÔ"
        lines.append(align_center(header_text.upper(), width))
        lines.append(draw_separator("=", width))
        
        # Metadata — type highlighted at top
        mesa_str = f"MESA: {mesa_id}" if mesa_id is not None else "RETIRADA / BALCAO"
        # Prominent order type
        lines.append(draw_separator("*", width))
        lines.append(align_center(f"  {tipo.upper()}  ", width))
        lines.append(draw_separator("*", width))
        lines.append(split_justified(f"PEDIDO: #{num_pedido}", mesa_str, width))
        lines.append(split_justified(
            "DATA: " + datetime.datetime.now().strftime("%d/%m/%Y"),
            "HORA: " + datetime.datetime.now().strftime("%H:%M"),
            width
        ))
        lines.append(split_justified(f"GARCOM: {garcom_nome}", "", width))
        lines.append(draw_separator("-", width))
        
        grand_total = 0.0
        
        if apenas_valores:
            lines.append(align_center("*** RESUMO FINANCEIRO (APENAS VALORES) ***", width))
            lines.append(draw_separator("-", width))
            
            # Calculate grand total without printing items
            for comanda in comandas_details:
                comanda_items = comanda.get("itens", [])
                for item in comanda_items:
                    if item.get("status") != "cancelado":
                        grand_total += item.get("preco_unit", 0.0)
        else:
            # Table of items header
            lines.append("ITEM".ljust(21) + "QTD".rjust(4) + "UNIT".rjust(7) + "TOTAL".rjust(8))
            lines.append(draw_separator("-", width))
            
            # Group all active items from all comandas by client name
            grouped_by_client = {}
            for comanda in comandas_details:
                comanda_items = comanda.get("itens", [])
                for item in comanda_items:
                    if item.get("status") == "cancelado":
                        continue
                    # Normalize client name
                    client = item.get("cliente_nome") or item.get("cliente_nome_custom") or comanda.get("identificador") or "Consumo Geral"
                    client = client.strip()
                    if not client or client.lower() == "consumo geral":
                        # Check if comanda identificador is more specific
                        comanda_ident = comanda.get("identificador")
                        if comanda_ident and comanda_ident.strip():
                            client = comanda_ident.strip()
                        else:
                            client = "Consumo Geral"
                    if client not in grouped_by_client:
                        grouped_by_client[client] = []
                    grouped_by_client[client].append(item)
                    
            # Loop over clients to output split values and items
            for client, items_list in grouped_by_client.items():
                lines.append(align_center(f"--- CLIENTE: {client.upper()} ---", width))
                
                grouped_items = {}
                for item in items_list:
                    key = (item["produto"]["nome"], item["preco_unit"])
                    grouped_items[key] = grouped_items.get(key, 0) + 1
                    
                client_subtotal = 0.0
                for (p_name, p_price), qty in grouped_items.items():
                    item_total = qty * p_price
                    client_subtotal += item_total
                    lines.append(format_item_line(p_name, qty, p_price, width))
                    
                lines.append(align_right(f"Subtotal {client}: R$ {client_subtotal:.2f}", width))
                grand_total += client_subtotal
                lines.append(draw_separator(".", width))
                
            # Remove last dot separator
            if lines and lines[-1] == draw_separator(".", width):
                lines.pop()
                
            lines.append(draw_separator("-", width))
        
        # Tax and grand total calculations
        if taxa_servico_ativa:
            service_charge = grand_total * (taxa_servico_padrao / 100.0)
            total_with_service = grand_total + service_charge
            lines.append(split_justified("SUBTOTAL CONSUMO:", f"R$ {grand_total:.2f}", width))
            lines.append(split_justified(f"TAXA DE SERVIÇO ({int(taxa_servico_padrao)}%):", f"R$ {service_charge:.2f}", width))
            lines.append(draw_separator("-", width))
            lines.append(split_justified("TOTAL GERAL DA MESA:", f"R$ {total_with_service:.2f}", width))
        else:
            lines.append(split_justified("TOTAL GERAL DA MESA:", f"R$ {grand_total:.2f}", width))
        lines.append(draw_separator("=", width))
        
        lines.append(align_center("Obrigado pela preferência!", width))
        if print_footer:
            lines.append(align_center(print_footer, width))
        lines.append(align_center("Documento não fiscal", width))
        
        if self.simulate:
            lines.append("\n" + align_center("[CUT]", width) + "\n")
            
        return "\n".join(lines)

    def generate_delivery_unified_ticket(self, comanda, motoboy_nome: str) -> str:
        width = self.width
        lines = []
        
        # Header (branding only on client/unified via)
        lines.append(draw_separator("=", width))
        lines.append(align_center("*** VIA ÚNICA DELIVERY ***", width))
        lines.append(align_center("KÔMA GOURMET BISTRÔ", width))
        lines.append(draw_separator("=", width))
        
        # Customer Info
        lines.append(f"CLIENTE: {comanda.identificador.upper() if comanda.identificador else 'NÃO INFORMADO'}")
        lines.append(f"TELEFONE: {mask_phone(comanda.delivery_telefone)}")
        lines.append(f"PEDIDO: #{comanda.numero_pedido} | ENTREGA")
        lines.append(f"MOTOBOY: {motoboy_nome.upper()}")
        lines.append(f"DATA: {datetime.datetime.now().strftime('%d/%m/%Y %H:%M')}")
        lines.append(draw_separator("-", width))
        
        # Items List
        lines.append("ITENS:")
        total = 0.0
        for it in comanda.itens:
            if it.status != "cancelado":
                lines.append(format_kitchen_item(1, it.produto.nome, it.observacao or "", it.cliente_nome or "", width))
                total += it.preco_unit
                
        lines.append(draw_separator("-", width))
        
        # Address
        lines.append("ENDEREÇO DE ENTREGA:")
        addr_lines = textwrap.wrap(comanda.delivery_endereco or "Não informado", width=width)
        lines.extend(addr_lines)
        lines.append(draw_separator("-", width))
        
        # Payment Status
        total_com_taxa = total + (comanda.delivery_taxa or 0.0)
        remaining = total_com_taxa - comanda.valor_pago
        if remaining <= 0.01 or comanda.fechada:
            pay_status = "[PAGO ONLINE - NÃO COBRAR]"
        else:
            pay_status = f"[COBRAR R$ {remaining:.2f} NO CARTÃO/DINHEIRO]"
            
        lines.append(align_center("PAGAMENTO:", width))
        lines.append(align_center(pay_status, width))
        lines.append(draw_separator("=", width))
        lines.append(align_center("Obrigado pela preferência!", width))
        lines.append(align_center("Documento não fiscal", width))
        
        if self.simulate:
            lines.append("\n" + align_center("[CUT]", width) + "\n")
            
        return "\n".join(lines)

    def generate_delivery_kitchen_ticket(self, comanda) -> str:
        width = self.width
        lines = []
        
        # No branding, compact header for kitchen
        lines.append(draw_separator("=", width))
        lines.append(align_center("*** VIA COZINHA (DELIVERY) ***", width))
        lines.append(draw_separator("=", width))
        
        lines.append(f"CLIENTE: {comanda.identificador.upper() if comanda.identificador else 'NÃO INFORMADO'}")
        lines.append(f"PEDIDO: #{comanda.numero_pedido} | ENTREGA")
        lines.append(f"DATA: {datetime.datetime.now().strftime('%d/%m/%Y %H:%M')}")
        lines.append(draw_separator("-", width))
        
        # Items List
        for it in comanda.itens:
            if it.status != "cancelado":
                lines.append(format_kitchen_item(1, it.produto.nome, it.observacao or "", it.cliente_nome or "", width))
                
        lines.append(draw_separator("=", width))
        
        if self.simulate:
            lines.append("\n" + align_center("[CUT]", width) + "\n")
            
        return "\n".join(lines)

    def generate_delivery_motoboy_ticket(self, comanda, motoboy_nome: str) -> str:
        width = self.width
        lines = []
        
        # Branding allowed on motoboy/client via
        lines.append(draw_separator("=", width))
        lines.append(align_center("*** VIA MOTOBOY / ENTREGA ***", width))
        lines.append(align_center("KÔMA GOURMET BISTRÔ", width))
        lines.append(draw_separator("=", width))
        
        lines.append(f"CLIENTE: {comanda.identificador.upper() if comanda.identificador else 'NÃO INFORMADO'}")
        lines.append(f"TELEFONE: {mask_phone(comanda.delivery_telefone)}")
        lines.append(f"PEDIDO: #{comanda.numero_pedido}")
        lines.append(f"MOTOBOY: {motoboy_nome.upper()}")
        lines.append(f"DATA: {datetime.datetime.now().strftime('%d/%m/%Y %H:%M')}")
        lines.append(draw_separator("-", width))
        
        # Items and Pricing
        lines.append("RESUMO DE VALORES:")
        total = 0.0
        for it in comanda.itens:
            if it.status != "cancelado":
                lines.append(split_justified(it.produto.nome[:22], f"R$ {it.preco_unit:.2f}", width))
                total += it.preco_unit
        lines.append(split_justified("TAXA DE ENTREGA:", f"R$ {comanda.delivery_taxa or 0.0:.2f}", width))
        
        total_com_taxa = total + (comanda.delivery_taxa or 0.0)
        lines.append(draw_separator("-", width))
        lines.append(split_justified("TOTAL GERAL:", f"R$ {total_com_taxa:.2f}", width))
        lines.append(draw_separator("-", width))
        
        # Address
        lines.append("ENDEREÇO DE ENTREGA:")
        addr_lines = textwrap.wrap(comanda.delivery_endereco or "Não informado", width=width)
        lines.extend(addr_lines)
        lines.append(draw_separator("-", width))
        
        # Payment Status
        remaining = total_com_taxa - comanda.valor_pago
        if remaining <= 0.01 or comanda.fechada:
            pay_status = "[PAGO ONLINE - NÃO COBRAR]"
        else:
            pay_status = f"[COBRAR R$ {remaining:.2f} NO CARTÃO/DINHEIRO]"
            
        lines.append(align_center("PAGAMENTO:", width))
        lines.append(align_center(pay_status, width))
        lines.append(draw_separator("=", width))
        lines.append(align_center("Obrigado pela preferência!", width))
        lines.append(align_center("Documento não fiscal", width))
        
        if self.simulate:
            lines.append("\n" + align_center("[CUT]", width) + "\n")
            
        return "\n".join(lines)

def mask_phone(phone: Optional[str]) -> str:
    if not phone:
        return "(XX) 9XXXX-XXXX"
    digits = "".join([c for c in phone if c.isdigit()])
    if len(digits) >= 4:
        ddd = digits[:2]
        last_two = digits[-2:]
        return f"({ddd}) 9XXXX-XX{last_two}"
    return "(XX) 9XXXX-XXXX"

printer_service = PrinterService()