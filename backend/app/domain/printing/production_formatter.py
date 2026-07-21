from typing import List, Dict
from .models import OrderPrintData, PrintItem
from .types import PaperWidth
from .grouping import group_items_by_customer, group_equivalent_items, normalize_observation

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

def format_production_document(data: OrderPrintData, width: PaperWidth = PaperWidth.WIDTH_80MM) -> str:
    """
    Gera o texto puro formatado para o documento TIPO 1 - PRODUÇÃO.
    
    Regras:
    - NÃO imprime preços, subtotais, totais, descontos, ingredientes ou endereço.
    - Filtra itens com destino NENHUM (devem ser filtrados antes ou durante a formatação).
    - Agrupa itens por cliente. Omite o nome 'GERAL' se for cliente único sem identificação.
    - Somente agrupa quantidades de itens se produto e observação forem exatamente iguais.
    - Observações aparecem abaixo do item sem o rótulo 'Observação:'.
    - Economiza papel ao máximo.
    """
    w = width.value if isinstance(width, PaperWidth) else int(width)
    lines: List[str] = []

    # 1. Cabeçalho
    restaurante = (data.restaurante_nome or "KÔMA").upper()
    lines.append(_center(restaurante, w))

    ped_num = str(data.numero_pedido).strip()
    ped_str = f"PED #{ped_num}" if ped_num and not ped_num.startswith("#") else f"PED {ped_num}" if ped_num else ""
    
    mesa_val = str(data.mesa).strip() if data.mesa else ""
    mesa_str = f"MESA {mesa_val}" if mesa_val and not mesa_val.upper().startswith("MESA") else mesa_val.upper()

    if ped_str and mesa_str:
        lines.append(_justify(ped_str, mesa_str, w))
    elif ped_str:
        lines.append(ped_str)
    elif mesa_str:
        lines.append(mesa_str)

    tipo_str = (data.tipo_pedido or "LOCAL").upper()
    horario_str = data.horario or ""
    if tipo_str and horario_str:
        lines.append(_justify(tipo_str, horario_str, w))
    elif tipo_str:
        lines.append(tipo_str)

    if data.garcom_nome:
        lines.append(_center(f"GARÇOM: {data.garcom_nome.upper()}", w))

    lines.append(_separator("-", w))

    # 2. Agrupamento por Cliente
    # Filtra apenas itens com destino diferente de NENHUM
    prod_items = [i for i in data.itens if (i.destino_impressao or "COZINHA").upper() not in ("NENHUM", "NONE", "")]
    
    by_client = group_items_by_customer(prod_items)
    
    # Se houver apenas 1 bloco chamado "GERAL", omitimos o cabeçalho do cliente para economizar papel
    omit_client_header = len(by_client) == 1 and "GERAL" in by_client

    first_block = True
    for client_name, c_items in by_client.items():
        if not c_items:
            continue

        if not first_block and not omit_client_header:
            lines.append(_separator("-", w))
        first_block = False

        if not omit_client_header:
            lines.append(client_name)

        # Agrupa itens equivalentes dentro do cliente (mesmo produto + mesma observação)
        grouped_c_items = group_equivalent_items(c_items, match_observations=True)

        for item in grouped_c_items:
            code_str = f"{item.codigo} " if item.codigo else ""
            item_line = f"{item.quantidade}x {code_str}{item.nome.upper()}".strip()
            lines.append(item_line)

            obs = normalize_observation(item.observacao)
            if obs:
                # Imprime observação indentada abaixo do item
                lines.append(f"   {obs.upper()}")

    lines.append(_separator("-", w))
    return "\n".join(lines)
