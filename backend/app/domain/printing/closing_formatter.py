from typing import List, Dict
from .models import CommandPrintData, PrintItem
from .types import PaperWidth
from .grouping import group_items_by_customer, group_equivalent_items

def _center(text: str, width: int) -> str:
    return text.strip().center(width)

def _separator(char: str = "-", width: int = 48) -> str:
    return char * width

def _justify(left: str, right: str, width: int) -> str:
    l_str = left.strip()
    r_str = right.strip()
    max_left = max(width - len(r_str) - 1, 1)
    if len(l_str) > max_left:
        l_str = l_str[:max_left]
    spaces = max(width - len(l_str) - len(r_str), 1)
    return l_str + (" " * spaces) + r_str

def _format_curr(value: float) -> str:
    return f"{value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")

def format_closing_document(data: CommandPrintData, width: PaperWidth = PaperWidth.WIDTH_80MM) -> str:
    """
    Gera o texto puro formatado para o documento TIPO 2 - FECHAMENTO.
    
    Regras:
    - Inclui TODOS os itens cobrados (independente de destino COZINHA ou NENHUM).
    - NÃO imprime observações, ingredientes ou descrições longas.
    - Imprime código + quantidade e valor total da linha.
    - Agrupa por cliente e calcula SUB por cliente quando houver divisão.
    - Imprime TOTAL geral ao final.
    """
    w = width.value if isinstance(width, PaperWidth) else int(width)
    lines: List[str] = []

    # 1. Cabeçalho
    restaurante = (data.restaurante_nome or "KÔMA").upper()
    lines.append(_center(restaurante, w))

    mesa_val = str(data.mesa).strip() if data.mesa else ""
    mesa_str = f"MESA {mesa_val}" if mesa_val and not mesa_val.upper().startswith("MESA") else (mesa_val or "CONTA").upper()
    data_hora_str = data.data_hora or ""

    if mesa_str and data_hora_str:
        lines.append(_justify(mesa_str, data_hora_str, w))
    elif mesa_str:
        lines.append(mesa_str)

    lines.append(_separator("-", w))

    # 2. Agrupamento por Cliente
    by_client = group_items_by_customer(data.itens)
    is_split_account = len(by_client) > 1 or (len(by_client) == 1 and "GERAL" not in by_client)

    total_geral = 0.0

    if is_split_account:
        first_block = True
        for client_name, c_items in by_client.items():
            if not c_items:
                continue

            if not first_block:
                lines.append(_separator("-", w))
            first_block = False

            lines.append(client_name)
            client_subtotal = 0.0

            # No fechamento, agrupamos itens equivalentes ignorando observação (match_observations=False)
            grouped_c_items = group_equivalent_items(c_items, match_observations=False)

            for item in grouped_c_items:
                item_total = item.total
                client_subtotal += item_total
                
                # Código preferencial, fallback para nome curto se não houver código
                code_label = item.codigo if item.codigo else item.nome
                left_str = f"{item.quantidade}x {code_label.upper()}".strip()
                right_str = _format_curr(item_total)
                lines.append(_justify(left_str, right_str, w))

            total_geral += client_subtotal
            lines.append(_separator("-", w))
            lines.append(_justify("SUBTOTAL", _format_curr(client_subtotal), w))
    else:
        # Conta única (todos no bloco GERAL)
        grouped_all = group_equivalent_items(data.itens, match_observations=False)
        for item in grouped_all:
            item_total = item.total
            total_geral += item_total
            code_label = item.codigo if item.codigo else item.nome
            left_str = f"{item.quantidade}x {code_label.upper()}".strip()
            right_str = _format_curr(item_total)
            lines.append(_justify(left_str, right_str, w))

    lines.append(_separator("-", w))

    if data.desconto > 0.0:
        lines.append(_justify("SUBTOTAL GERAL", _format_curr(total_geral), w))
        lines.append(_justify("DESCONTO", f"-{_format_curr(data.desconto)}", w))
        lines.append(_separator("-", w))
        total_geral = max(0.0, total_geral - data.desconto)

    lines.append(_justify("TOTAL", _format_curr(total_geral), w))
    return "\n".join(lines)
