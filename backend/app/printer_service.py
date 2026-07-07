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
    def __init__(self):
        self.width = settings.PRINTER_WIDTH
        self.jobs_dir = settings.PRINT_JOBS_DIR
        self.simulate = settings.SIMULATE_PRINTER

    def send_to_printer(self, doc_type: str, content: str):
        if self.simulate:
            # Make sure jobs directory exists
            os.makedirs(self.jobs_dir, exist_ok=True)
            timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"job_{doc_type}_{timestamp}_{secrets.token_hex(4)}.txt"
            filepath = os.path.join(self.jobs_dir, filename)
            
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(content)
                
            print(f"[PRINTER SIMULATION] Job '{doc_type}' saved to {filepath}")
            return filepath
        else:
            # Physical Printing
            if os.name == 'posix':
                try:
                    device_path = "/dev/usb/lp0"
                    with open(device_path, "wb") as f:
                        # Initialize: ESC @
                        f.write(b"\x1b@")
                        # ESC/POS: Select Page Code (ESC t 16) for cp858/Latin-1 superset
                        f.write(b"\x1bt\x10")
                        raw_data = content.encode('cp1252', errors='replace')
                        f.write(raw_data)
                        # Feed and cut: GS V 66 0
                        f.write(b"\n\n\x1dV\x42\x00")
                    print(f"Printed successfully to raw USB port {device_path}")
                except Exception as e:
                    print(f"Error printing on Linux to USB port: {e}")
            else:
                # Physical Windows printing (pywin32 / Win32Raw)
                try:
                    import win32print
                    
                    hPrinter = win32print.OpenPrinter(settings.PRINTER_NAME)
                    try:
                        hJob = win32print.StartDocPrinter(hPrinter, 1, (f"Koma {doc_type}", None, "RAW"))
                        win32print.StartPagePrinter(hPrinter)
                        
                        # Initialize printer: ESC @
                        init_command = b"\x1b@"
                        # ESC/POS: Select Page Code (ESC t 16) for cp858/Latin-1 superset
                        init_command += b"\x1bt\x10"
                        
                        # Convert to cp1252 (Windows Latin-1 — better Portuguese char support)
                        raw_data = content.encode('cp1252', errors='replace')
                        
                        # Feed lines and partial cut command (ESC/POS: GS V 66 0 / \x1d\x56\x42\x00)
                        cut_commands = b"\n\n\x1d\x56\x42\x00"
                        
                        win32print.WritePrinter(hPrinter, init_command + raw_data + cut_commands)
                        win32print.EndPagePrinter(hPrinter)
                        win32print.EndDocPrinter(hPrinter)
                    finally:
                        win32print.ClosePrinter(hPrinter)
                except Exception as e:
                    print(f"Error printing physically to printer '{settings.PRINTER_NAME}': {e}")
                    raise e

    def generate_kitchen_ticket(self, num_pedido: int, tipo: str, mesa_id: Optional[int], garcom_nome: str, items: list, is_reprint: bool = False) -> str:
        width = self.width
        lines = []
        
        # Header banner
        lines.append(draw_separator("=", width))
        title = "*** REIMPRESSÃO COZINHA ***" if is_reprint else "*** TICKET DE COZINHA ***"
        lines.append(align_center(title, width))
        lines.append(draw_separator("=", width))
        
        # Compact single-line header
        mesa_str = f"MESA: {mesa_id}" if mesa_id is not None else "RETIRADA / BALCAO"
        # Prominent order type banner
        lines.append(draw_separator(" ", width))
        lines.append(align_center(f"[ {tipo.upper()} ]", width))
        lines.append(draw_separator(" ", width))
        lines.append(align_center(f"{mesa_str}  |  PEDIDO #{num_pedido}", width))
        lines.append(split_justified(
            f"GARCOM: {garcom_nome.upper()}",
            datetime.datetime.now().strftime("%d/%m %H:%M"),
            width
        ))
        lines.append(draw_separator("-", width))
        
        # Group items by client
        grouped = {}
        for item in items:
            client = item.get("cliente_nome") or "Consumo Geral"
            client = client.strip()
            if not client:
                client = "Consumo Geral"
            grouped.setdefault(client, []).append(item)

        # Print "Consumo Geral" first
        if "Consumo Geral" in grouped:
            for item in grouped["Consumo Geral"]:
                lines.append(format_kitchen_item(
                    qty=item.get("quantidade", 1),
                    name=item.get("nome", ""),
                    observation=item.get("observacao", ""),
                    client_name="",
                    width=width,
                    preco_unit=item.get("preco_unit", 0.0)
                ))
                lines.append(draw_separator(".", width))
            del grouped["Consumo Geral"]
            
        # Print named clients
        for client in sorted(grouped.keys()):
            if lines and lines[-1] == draw_separator(".", width):
                lines.pop()
            
            lines.append(draw_separator("-", width))
            lines.append(f"PARA: {client.upper()}")
            lines.append(draw_separator("-", width))
            
            for item in grouped[client]:
                lines.append(format_kitchen_item(
                    qty=item.get("quantidade", 1),
                    name=item.get("nome", ""),
                    observation=item.get("observacao", ""),
                    client_name="",
                    width=width,
                    preco_unit=item.get("preco_unit", 0.0)
                ))
                lines.append(draw_separator(".", width))
            
        # Remove last separator dots
        if lines and lines[-1] == draw_separator(".", width):
            lines.pop()
            
        lines.append(draw_separator("-", width))
        lines.append(align_center("KÔMA RESTAURANTE - PRODUÇÃO", width))
        
        # Feed/Cut placeholder
        if self.simulate:
            lines.append("\n" + align_center("[CUT]", width) + "\n")
            
        return "\n".join(lines)

    def generate_receipt(self, num_pedido: int, tipo: str, mesa_id: Optional[int], garcom_nome: str, comandas_details: list, print_header: Optional[str] = None, print_footer: Optional[str] = None, taxa_servico_ativa: bool = True, taxa_servico_padrao: float = 10.0) -> str:
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
        
        # Table of items header
        lines.append("ITEM".ljust(21) + "QTD".rjust(4) + "UNIT".rjust(7) + "TOTAL".rjust(8))
        lines.append(draw_separator("-", width))
        
        grand_total = 0.0
        
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
