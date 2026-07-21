from typing import List, Dict, Tuple
from .types import ProductionDocumentData, PaperWidth, PrintItemData
from .formatter import center_text, separator, justify_two_columns, wrap_text

def format_production_document(data: ProductionDocumentData, width: PaperWidth = PaperWidth.WIDTH_80MM) -> str:
    """
    Formata o documento TIPO 1 - PRODUÇÃO (Cozinha/Bar).
    
    Regras:
    - NÃO imprime preços, subtotal, total, desconto, ingredientes ou endereço.
    - Imprime cabeçalho (Restaurante, Pedido #, Mesa, Tipo, Horário, Garçom).
    - Agrupa os itens por cliente.
    - Agrupa itens idênticos do mesmo cliente somente quando tiverem a mesma observação.
    - Observações são exibidas logo abaixo do item correspondente.
    - Otimizado para economizar papel.
    """
    w = width.value if isinstance(width, PaperWidth) else int(width)
    lines: List[str] = []

    # 1. Cabeçalho
    restaurante = (data.restaurante_nome or "KÔMA").upper()
    lines.append(center_text(restaurante, w))

    ped_str = f"PED #{data.numero_pedido}" if data.numero_pedido and not str(data.numero_pedido).startswith("#") else f"PED {data.numero_pedido}" if data.numero_pedido else ""
    mesa_str = f"MESA {data.mesa}" if data.mesa and not str(data.mesa).upper().startswith("MESA") else (data.mesa or "").upper()

    if ped_str and mesa_str:
        lines.append(justify_two_columns(ped_str, mesa_str, w))
    elif ped_str:
        lines.append(ped_str)
    elif mesa_str:
        lines.append(mesa_str)

    tipo_str = (data.tipo_pedido or "LOCAL").upper()
    horario_str = data.horario or ""
    if tipo_str and horario_str:
        lines.append(justify_two_columns(tipo_str, horario_str, w))
    elif tipo_str:
        lines.append(tipo_str)

    if data.garcom_nome:
        lines.append(center_text(f"GARÇOM: {data.garcom_nome.upper()}", w))

    lines.append(separator("-", w))

    # 2. Agrupamento de itens por Cliente -> (Código, Nome, Observação)
    clients_map: Dict[str, List[PrintItemData]] = {}
    for item in data.itens:
        c_name = (item.cliente_nome or "Consumo Geral").strip().upper()
        if c_name not in clients_map:
            clients_map[c_name] = []
        clients_map[c_name].append(item)

    first_client = True
    for client_name, item_list in clients_map.items():
        if not first_client:
            lines.append(separator("-", w))
        first_client = False

        # Exibe cabeçalho do cliente
        lines.append(client_name)

        # Agrupa itens do mesmo produto e mesma observação dentro do cliente
        grouped_items: List[PrintItemData] = []
        for item in item_list:
            code = (item.codigo or "").strip().upper()
            name = (item.nome or "").strip().upper()
            obs = (item.observacao or "").strip()

            # Procura item idêntico já agrupado no mesmo cliente
            matched = False
            for g_item in grouped_items:
                if (g_item.codigo.strip().upper() == code and 
                    g_item.nome.strip().upper() == name and 
                    (g_item.observacao or "").strip() == obs):
                    g_item.quantidade += item.quantidade
                    matched = True
                    break
            
            if not matched:
                grouped_items.append(PrintItemData(
                    codigo=code,
                    nome=name,
                    quantidade=item.quantidade,
                    cliente_nome=client_name,
                    observacao=obs
                ))

        # Renderiza itens do cliente
        for g_item in grouped_items:
            code_prefix = f"{g_item.codigo} " if g_item.codigo else ""
            item_line = f"{g_item.quantidade}x {code_prefix}{g_item.nome}".strip()
            lines.append(item_line)

            if g_item.observacao:
                obs_lines = wrap_text(g_item.observacao, w, indent="   ")
                lines.extend(obs_lines)

    lines.append(separator("-", w))

    # 3. Rodapé
    if data.numero_lancamento:
        lanc_str = f"LANÇAMENTO: #{data.numero_lancamento}" if not str(data.numero_lancamento).startswith("#") else f"LANÇAMENTO: {data.numero_lancamento}"
        lines.append(center_text(lanc_str, w))

    lines.append(center_text("OBRIGADO!", w))

    return "\n".join(lines)
