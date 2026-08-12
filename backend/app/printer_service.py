import datetime
import textwrap
from typing import List, Optional
from .config import settings
from .timezone_utils import get_operational_now, to_operational_local_time

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


ESC_FONT_A = "\x1bM\x00"
ESC_FONT_B = "\x1bM\x01"
ESC_BOLD_ON = "\x1bE\x01"
ESC_BOLD_OFF = "\x1bE\x00"
ESC_DOUBLE_HEIGHT_ON = "\x1b!\x10"
ESC_NORMAL_SIZE = "\x1b!\x00"
ESC_TIGHT_LINE = "\x1b3\x18"


def _single_line(value: object) -> str:
    """Normaliza conteúdo livre sem permitir quebras artificiais no cupom."""
    return " ".join(str(value or "").replace("\x00", "").split())


def _format_brl(value: float) -> str:
    return f"R$ {value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _order_type_label(tipo: object, mesa_id: Optional[int]) -> str:
    """Converte variações internas no rótulo curto que o salão reconhece."""
    raw = _single_line(tipo)
    normalized = raw.casefold()
    if any(term in normalized for term in ("delivery", "entrega")):
        return "DELIVERY"
    if any(term in normalized for term in ("retir", "viagem", "balc")):
        return "RETIRADA"
    if mesa_id is not None or any(
        term in normalized for term in ("mesa", "local", "consumo", "salão", "salao")
    ):
        return "CONSUMO NO LOCAL"
    return raw.upper() or "CONSUMO NO LOCAL"


def _is_general_client(value: object) -> bool:
    """Consumo Geral é a conta padrão da mesa, não uma pessoa identificada."""
    return _single_line(value).casefold() in {"", "geral", "consumo geral"}


def _append_wrapped(lines: list[str], text: str, width: int, prefix: str = "") -> None:
    available = max(width - len(prefix), 1)
    wrapped = textwrap.wrap(
        _single_line(text),
        width=available,
        break_long_words=True,
        break_on_hyphens=False,
    ) or [""]
    lines.append(prefix + wrapped[0])
    continuation_prefix = " " * len(prefix)
    lines.extend(continuation_prefix + part for part in wrapped[1:])


def _append_wrapped_in_font(
    lines: list[str],
    text: str,
    width: int,
    prefix: str,
    font: str,
    restore_font: str = ESC_FONT_A,
) -> None:
    """Aplica fonte sem criar linhas vazias só para comandos ESC/POS."""
    wrapped_lines: list[str] = []
    _append_wrapped(wrapped_lines, text, width, prefix)
    wrapped_lines[0] = font + wrapped_lines[0]
    wrapped_lines[-1] += restore_font
    lines.extend(wrapped_lines)


def _printable_product_name(code: str, name: str) -> str:
    """Oculta o código técnico somente na apresentação dos cupons."""
    clean_name = _single_line(name)
    clean_code = _single_line(code)
    if not clean_code:
        return clean_name

    normalized_name = clean_name.casefold()
    prefixes = (
        f"{clean_code} - ",
        f"{clean_code}-",
        f"[{clean_code}] ",
        f"[{clean_code}]",
    )
    for prefix in prefixes:
        if normalized_name.startswith(prefix.casefold()):
            return clean_name[len(prefix):].lstrip()
    return clean_name


def _append_amount_line(lines: list[str], left: str, right: str, width: int) -> None:
    """Imprime texto e valor sem cortar nomes longos de produtos/clientes."""
    max_left = max(width - len(right) - 1, 1)
    wrapped = textwrap.wrap(
        _single_line(left),
        width=max_left,
        break_long_words=True,
        break_on_hyphens=False,
    ) or [""]
    lines.append(split_justified(wrapped[0], right, width))
    for continuation in wrapped[1:]:
        lines.append(f"   {continuation}"[:width])


def _append_bold_amount_line(
    lines: list[str], left: str, right: str, width: int
) -> None:
    """Destaca itens/valores sem duplicar a altura e o consumo de papel."""
    first_line = len(lines)
    _append_amount_line(lines, left, right, width)
    lines[first_line] = ESC_BOLD_ON + lines[first_line]
    lines[-1] += ESC_BOLD_OFF


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
    """Formata cupons; persistência e hardware pertencem à fila PrintJob."""

    def __init__(self):
        self.width = settings.PRINTER_WIDTH


    def generate_kitchen_ticket(
        self,
        num_pedido: int,
        tipo: str,
        mesa_id: Optional[int],
        garcom_nome: str,
        items: list,
        is_reprint: bool = False,
        restaurant_name: Optional[str] = None,
        restaurant_name_position: str = "cabecalho",
        print_footer: Optional[str] = None,
    ) -> str:
        width = self.width
        lines: list[str] = []
        position = (
            restaurant_name_position
            if restaurant_name_position in {"cabecalho", "rodape", "oculto"}
            else "cabecalho"
        )
        brand = _single_line(restaurant_name or "KÔMA GOURMET BISTRÔ")
        order_type = _order_type_label(tipo, mesa_id)
        garcom_str = _single_line(garcom_nome or "CAIXA").upper()
        now = get_operational_now()

        lines.append(ESC_TIGHT_LINE + ESC_FONT_A)
        lines.append(draw_separator("=", width))
        if position == "cabecalho" and brand:
            lines.append(
                ESC_DOUBLE_HEIGHT_ON
                + ESC_BOLD_ON
                + align_center(brand.upper(), width)
                + ESC_BOLD_OFF
                + ESC_NORMAL_SIZE
            )
            lines.append(draw_separator("=", width))

        lines.append(
            ESC_DOUBLE_HEIGHT_ON
            + ESC_BOLD_ON
            + align_center(order_type, width)
            + ESC_BOLD_OFF
            + ESC_NORMAL_SIZE
        )
        if is_reprint:
            lines.append(ESC_BOLD_ON + align_center("REIMPRESSÃO", width) + ESC_BOLD_OFF)
        lines.append(draw_separator("=", width))
        mesa_str = f"MESA: {mesa_id}" if mesa_id is not None else "SEM MESA"
        lines.append(
            ESC_DOUBLE_HEIGHT_ON
            + ESC_BOLD_ON
            + split_justified(f"PEDIDO: #{num_pedido}", mesa_str, width)
            + ESC_BOLD_OFF
            + ESC_NORMAL_SIZE
        )
        lines.append(
            split_justified(
                f"DATA: {now.strftime('%d/%m/%Y')}",
                f"HORA: {now.strftime('%H:%M')}",
                width,
            )
        )
        lines.append(f"GARÇOM: {garcom_str}")
        lines.append(draw_separator("-", width))

        # Agrupa primeiro por pessoa e só então por item. Assim o nome do cliente
        # aparece uma vez por bloco, em vez de ser repetido em cada linha.
        grouped_by_client: dict[str, dict] = {}
        for item in items:
            if safe_get(item, "status") == "cancelado":
                continue

            produto = safe_get(item, "produto")
            nome = _single_line(
                safe_get(item, "nome") or safe_get(produto, "nome")
            )
            codigo = _single_line(
                safe_get(item, "codigo") or safe_get(produto, "id")
            )
            observacao = _single_line(safe_get(item, "observacao"))
            cliente = _single_line(
                safe_get(item, "cliente_nome")
                or safe_get(item, "cliente_nome_custom")
                or "Consumo Geral"
            ) or "Consumo Geral"
            quantidade = max(int(safe_get(item, "quantidade") or 1), 1)

            client_key = cliente.casefold()
            client_group = grouped_by_client.setdefault(
                client_key,
                {"label": cliente, "items": {}},
            )
            item_key = (codigo, nome, observacao)
            client_group["items"][item_key] = (
                client_group["items"].get(item_key, 0) + quantidade
            )

        for group_index, client_group in enumerate(grouped_by_client.values()):
            if group_index:
                lines.append(draw_separator("-", width))
            if not _is_general_client(client_group["label"]):
                client_label = f"CLIENTE: {client_group['label'].upper()}"
                lines.append(
                    ESC_FONT_A
                    + ESC_BOLD_ON
                    + align_center(client_label, width)
                    + ESC_BOLD_OFF
                )

            for (
                codigo,
                nome,
                observacao,
            ), quantidade in client_group["items"].items():
                printable_name = _printable_product_name(codigo, nome)
                item_text = f"{quantidade}x {printable_name}"
                item_lines = textwrap.wrap(
                    item_text,
                    width=width,
                    break_long_words=True,
                    break_on_hyphens=False,
                ) or [""]
                rendered_item_lines = item_lines[:1]
                rendered_item_lines.extend(
                    f"   {part}"[:width] for part in item_lines[1:]
                )
                rendered_item_lines[0] = (
                    ESC_FONT_A
                    + ESC_DOUBLE_HEIGHT_ON
                    + ESC_BOLD_ON
                    + rendered_item_lines[0]
                )
                rendered_item_lines[-1] += ESC_BOLD_OFF + ESC_NORMAL_SIZE
                lines.extend(rendered_item_lines)

                if observacao:
                    _append_wrapped_in_font(
                        lines,
                        observacao.upper(),
                        width,
                        "   OBS: ",
                        ESC_FONT_A,
                    )
                lines.append("")

        lines.append(ESC_FONT_A)
        lines.append(draw_separator("-", width))
        if print_footer:
            _append_wrapped(lines, print_footer, width)
        if position == "rodape" and brand:
            lines.append(
                ESC_BOLD_ON + align_center(brand.upper(), width) + ESC_BOLD_OFF
            )
        lines.append(align_center("Gerenciado por Kôma", width))

        return "\n".join(lines)


    def generate_receipt(
        self,
        num_pedido: int,
        tipo: str,
        mesa_id: Optional[int],
        garcom_nome: str,
        comandas_details: list,
        opened_at: Optional[datetime.datetime] = None,
        print_header: Optional[str] = None,
        print_footer: Optional[str] = None,
        taxa_servico_ativa: bool = True,
        taxa_servico_padrao: float = 10.0,
        apenas_valores: bool = False,
        restaurant_name_position: str = "cabecalho",
    ) -> str:
        width = self.width
        lines: list[str] = [ESC_TIGHT_LINE + ESC_FONT_A]
        position = (
            restaurant_name_position
            if restaurant_name_position in {"cabecalho", "rodape", "oculto"}
            else "cabecalho"
        )
        header_text = _single_line(print_header or "KÔMA GOURMET BISTRÔ")

        lines.append(draw_separator("=", width))
        now = get_operational_now()
        if apenas_valores and mesa_id is not None:
            opening_time = opened_at or now
            if isinstance(opening_time, datetime.datetime) and opening_time.tzinfo is not None:
                opening_time = to_operational_local_time(opening_time)
            opening_str = (
                opening_time.strftime("%H:%M")
                if isinstance(opening_time, (datetime.datetime, datetime.date))
                else str(opening_time)[:5]
            )
            lines.append(
                ESC_BOLD_ON
                + align_center("FECHAMENTO", width)
                + ESC_BOLD_OFF
            )
            lines.append(draw_separator("=", width))
            lines.append(
                ESC_BOLD_ON
                + split_justified(
                    f"MESA: {mesa_id}",
                    f"ABERTURA: {opening_str}",
                    width,
                )
                + ESC_BOLD_OFF
            )
            lines.append(draw_separator("=", width))
        else:
            if position == "cabecalho" and header_text:
                lines.append(
                    ESC_BOLD_ON
                    + align_center(header_text.upper(), width)
                    + ESC_BOLD_OFF
                )
                lines.append(draw_separator("=", width))
            order_type = _order_type_label(tipo, mesa_id)
            lines.append(
                ESC_BOLD_ON
                + align_center(order_type, width)
                + ESC_BOLD_OFF
            )
            lines.append(draw_separator("=", width))

            mesa_str = f"MESA: {mesa_id}" if mesa_id is not None else "SEM MESA"
            lines.append(
                ESC_BOLD_ON
                + split_justified(f"PEDIDO: #{num_pedido}", mesa_str, width)
                + ESC_BOLD_OFF
            )
            lines.append(
                split_justified(
                    f"DATA: {now.strftime('%d/%m/%Y')}",
                    f"HORA: {now.strftime('%H:%M')}",
                    width,
                )
            )
            lines.append(f"GARÇOM: {_single_line(garcom_nome)}")
            lines.append(draw_separator("-", width))

        grand_total = 0.0
        grouped_by_client: dict[str, dict] = {}
        for comanda in comandas_details:
            for item in comanda.get("itens", []):
                if item.get("status") == "cancelado":
                    continue
                client = (
                    item.get("cliente_nome")
                    or item.get("cliente_nome_custom")
                    or comanda.get("identificador")
                    or "Consumo Geral"
                )
                client = _single_line(client) or "Consumo Geral"
                client_key = client.casefold()
                group = grouped_by_client.setdefault(
                    client_key,
                    {"label": client, "items": []},
                )
                group["items"].append(item)

        has_named_client = any(
            not _is_general_client(group["label"])
            for group in grouped_by_client.values()
        )

        for group_index, group in enumerate(grouped_by_client.values()):
            client = group["label"]
            items_list = group["items"]
            is_general = _is_general_client(client)
            if not is_general:
                lines.append(
                    ESC_BOLD_ON
                    + align_center(f"CLIENTE: {client.upper()}", width)
                    + ESC_BOLD_OFF
                )

            grouped_items: dict[
                tuple[str, str, float, str],
                int,
            ] = {}
            for item in items_list:
                produto = item["produto"]
                product_name = _single_line(produto["nome"])
                product_code = _single_line(
                    item.get("codigo") or produto.get("id")
                )
                observation = (
                    ""
                    if apenas_valores
                    else _single_line(item.get("observacao"))
                )
                key = (
                    product_code,
                    product_name,
                    float(item["preco_unit"]),
                    observation,
                )
                qty = max(int(item.get("quantidade") or 1), 1)
                grouped_items[key] = grouped_items.get(key, 0) + qty

            client_subtotal = 0.0
            for (
                product_code,
                product_name,
                unit_price,
                observation,
            ), qty in grouped_items.items():
                item_total = qty * unit_price
                client_subtotal += item_total
                printable_name = _printable_product_name(
                    product_code,
                    product_name,
                )
                left = f"{qty}x {printable_name.upper()}"
                _append_bold_amount_line(
                    lines,
                    left,
                    _format_brl(item_total),
                    width,
                )
                if not apenas_valores and observation:
                    _append_wrapped_in_font(
                        lines,
                        observation.upper(),
                        width,
                        "   OBS: ",
                        ESC_FONT_A,
                    )
                lines.append("")

            grand_total += client_subtotal
            lines.append(draw_separator("-", width))
            if is_general and not has_named_client:
                continue

            subtotal_label = (
                "SUBTOTAL CONSUMO GERAL"
                if is_general
                else f"SUBTOTAL {client.upper()}"
            )
            _append_amount_line(
                lines,
                subtotal_label,
                _format_brl(client_subtotal),
                width,
            )
            lines.append(draw_separator("-", width))

        if taxa_servico_ativa:
            service_charge = grand_total * (taxa_servico_padrao / 100.0)
            total_with_service = grand_total + service_charge
            lines.append(
                split_justified(
                    "SUBTOTAL CONSUMO:",
                    _format_brl(grand_total),
                    width,
                )
            )
            lines.append(
                split_justified(
                    f"TAXA DE SERVIÇO ({taxa_servico_padrao:g}%):",
                    _format_brl(service_charge),
                    width,
                )
            )
            lines.append(draw_separator("-", width))
            final_total = total_with_service
        else:
            final_total = grand_total

        lines.append(
            ESC_BOLD_ON
            + split_justified(
                "TOTAL GERAL DA MESA:",
                _format_brl(final_total),
                width,
            )
            + ESC_BOLD_OFF
        )
        lines.append(draw_separator("=", width))

        lines.append(align_center("Gerenciado por Kôma", width))
        if print_footer:
            _append_wrapped(lines, print_footer, width)
        if not apenas_valores and position == "rodape" and header_text:
            lines.append(
                ESC_BOLD_ON
                + align_center(header_text.upper(), width)
                + ESC_BOLD_OFF
            )
        lines.append(align_center("Documento não fiscal", width))

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
        lines.append(f"DATA: {get_operational_now().strftime('%d/%m/%Y %H:%M')}")
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
        lines.append(f"DATA: {get_operational_now().strftime('%d/%m/%Y %H:%M')}")
        lines.append(draw_separator("-", width))
        
        # Items List
        for it in comanda.itens:
            if it.status != "cancelado":
                lines.append(format_kitchen_item(1, it.produto.nome, it.observacao or "", it.cliente_nome or "", width))
                
        lines.append(draw_separator("=", width))
        
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
        lines.append(f"DATA: {get_operational_now().strftime('%d/%m/%Y %H:%M')}")
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
