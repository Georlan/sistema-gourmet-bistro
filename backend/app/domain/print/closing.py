from typing import List, Dict
from .types import ClosingDocumentData, PaperWidth, PrintItemData
from .formatter import center_text, separator, justify_two_columns, format_currency

def format_closing_document(data: ClosingDocumentData, width: PaperWidth = PaperWidth.WIDTH_80MM) -> str:
    """
    Formata o documento TIPO 2 - FECHAMENTO (Conferência / Conta).
    
    Regras:
    - NÃO imprime observações, ingredientes, descrições grandes ou modificações.
    - Imprime cabeçalho (Mesa, Data/Hora).
    - Agrupa por cliente se houver divisão da conta entre múltiplos clientes.
    - Formato resumido: Quantidade + Código + Valor.
    - Exibe subtotais por cliente (se dividido) e Total geral ao final.
    - Otimizado para gastar o mínimo possível de papel.
    """
    w = width.value if isinstance(width, PaperWidth) else int(width)
    lines: List[str] = []

    # 1. Cabeçalho
    restaurante = (data.restaurante_nome or "KÔMA").upper()
    lines.append(center_text(restaurante, w))

    mesa_str = f"MESA {data.mesa}" if data.mesa and not str(data.mesa).upper().startswith("MESA") else (data.mesa or "CONTA").upper()
    data_hora_str = data.data_hora or ""

    if mesa_str and data_hora_str:
        lines.append(justify_two_columns(mesa_str, data_hora_str, w))
    elif mesa_str:
        lines.append(mesa_str)

    lines.append(separator("-", w))

    # 2. Verifica se há divisão por múltiplos clientes nomeados
    clients_map: Dict[str, List[PrintItemData]] = {}
    for item in data.itens:
        c_name = (item.cliente_nome or "Consumo Geral").strip().upper()
        if c_name not in clients_map:
            clients_map[c_name] = []
        clients_map[c_name].append(item)

    is_split_account = len(clients_map) > 1 or (len(clients_map) == 1 and "CONSUMO GERAL" not in clients_map)

    total_geral = 0.0

    if is_split_account:
        first_client = True
        for client_name, item_list in clients_map.items():
            if not first_client:
                lines.append(separator("-", w))
            first_client = False

            lines.append(client_name)
            client_subtotal = 0.0

            # Agrupa itens idênticos do mesmo cliente por código/nome
            grouped_items: Dict[str, PrintItemData] = {}
            for item in item_list:
                code = (item.codigo or item.nome or "ITEM").strip().upper()
                if code not in grouped_items:
                    grouped_items[code] = PrintItemData(
                        codigo=code,
                        nome=item.nome,
                        quantidade=0,
                        preco_unit=item.preco_unit,
                        cliente_nome=client_name
                    )
                grouped_items[code].quantidade += item.quantidade

            for g_item in grouped_items.values():
                item_total = g_item.total
                client_subtotal += item_total
                left_str = f"{g_item.quantidade}x {g_item.codigo}".strip()
                right_str = format_currency(item_total)
                lines.append(justify_two_columns(left_str, right_str, w))

            total_geral += client_subtotal
            lines.append(separator("-", w))
            lines.append(justify_two_columns("SUBTOTAL", format_currency(client_subtotal), w))
    else:
        # Conta única (sem divisão de clientes)
        grouped_items: Dict[str, PrintItemData] = {}
        for item in data.itens:
            code = (item.codigo or item.nome or "ITEM").strip().upper()
            if code not in grouped_items:
                grouped_items[code] = PrintItemData(
                    codigo=code,
                    nome=item.nome,
                    quantidade=0,
                    preco_unit=item.preco_unit
                )
            grouped_items[code].quantidade += item.quantidade

        for g_item in grouped_items.values():
            item_total = g_item.total
            total_geral += item_total
            left_str = f"{g_item.quantidade}x {g_item.codigo}".strip()
            right_str = format_currency(item_total)
            lines.append(justify_two_columns(left_str, right_str, w))

    lines.append(separator("-", w))

    # 3. Totais e Desconto
    if data.desconto > 0.0:
        lines.append(justify_two_columns("SUBTOTAL GERAL", format_currency(total_geral), w))
        lines.append(justify_two_columns("DESCONTO", f"-{format_currency(data.desconto)}", w))
        lines.append(separator("-", w))
        total_geral = max(0.0, total_geral - data.desconto)

    lines.append(justify_two_columns("TOTAL", format_currency(total_geral), w))
    lines.append(center_text("OBRIGADO!", w))

    return "\n".join(lines)
