import textwrap
from typing import List
from .models import DeliveryOrderPrintData, PrintItem
from .types import PaperWidth
from .grouping import group_equivalent_items

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

def format_delivery_document(data: DeliveryOrderPrintData, width: PaperWidth = PaperWidth.WIDTH_80MM) -> str:
    """
    Gera o texto puro formatado para o documento TIPO 3 - ENTREGA.
    
    Regras:
    - Inclui TODOS os itens cobrados.
    - NÃO imprime ingredientes nem destino de categoria nem observações internas da cozinha.
    - Imprime endereço completo (Logradouro, Bairro, Complemento se houver, Referência se houver).
    - Imprime Subtotal, Taxa de entrega, Desconto (se > 0) e Total final.
    - Imprime Forma de pagamento e Troco (apenas quando aplicável).
    - Imprime observação específica da entrega se fornecida.
    """
    w = width.value if isinstance(width, PaperWidth) else int(width)
    lines: List[str] = []

    # 1. Cabeçalho
    restaurante = (data.restaurante_nome or "KÔMA").upper()
    lines.append(_center(restaurante, w))

    ped_num = str(data.numero_pedido).strip()
    ped_str = f"PED #{ped_num}" if ped_num and not ped_num.startswith("#") else f"PED {ped_num}" if ped_num else "PEDIDO"
    lines.append(_justify(ped_str, "DELIVERY", w))

    if data.data_hora:
        lines.append(_center(data.data_hora, w))

    lines.append(_separator("-", w))

    # 2. Dados do Cliente e Endereço
    if data.cliente_nome:
        lines.append(data.cliente_nome.upper())
    
    if data.cliente_telefone:
        lines.append(data.cliente_telefone)

    if data.logradouro:
        for wrap_line in textwrap.wrap(data.logradouro.upper(), width=w):
            lines.append(wrap_line)
    
    if data.bairro:
        lines.append(data.bairro.upper())

    if data.complemento:
        for wrap_line in textwrap.wrap(data.complemento.upper(), width=w):
            lines.append(wrap_line)

    if data.ponto_referencia:
        ref_text = f"REF: {data.ponto_referencia}".upper()
        for wrap_line in textwrap.wrap(ref_text, width=w):
            lines.append(wrap_line)

    lines.append(_separator("-", w))

    # 3. Lista de Itens com Valores (Sem observações internas da cozinha)
    subtotal_itens = 0.0
    grouped_items = group_equivalent_items(data.itens, match_observations=False)

    for item in grouped_items:
        item_total = item.total
        subtotal_itens += item_total
        
        code_str = f"{item.codigo} " if item.codigo else ""
        left_str = f"{item.quantidade}x {code_str}{item.nome.upper()}".strip()
        right_str = _format_curr(item_total)
        lines.append(_justify(left_str, right_str, w))

    lines.append(_separator("-", w))

    # 4. Totais
    lines.append(_justify("SUBTOTAL", _format_curr(subtotal_itens), w))
    
    if data.taxa_entrega > 0.0:
        lines.append(_justify("TAXA ENTREGA", _format_curr(data.taxa_entrega), w))

    if data.desconto > 0.0:
        lines.append(_justify("DESCONTO", f"-{_format_curr(data.desconto)}", w))

    total_final = max(0.0, subtotal_itens + data.taxa_entrega - data.desconto)
    lines.append(_separator("-", w))
    lines.append(_justify("TOTAL", _format_curr(total_final), w))
    lines.append("")

    # 5. Forma de Pagamento e Troco
    pag_str = f"PAG: {(data.forma_pagamento or 'DINHEIRO').upper()}"
    lines.append(pag_str)

    if data.valor_troco is not None and data.valor_troco > 0.0:
        lines.append(f"TROCO: {_format_curr(data.valor_troco)}")
    elif data.troco_para is not None and data.troco_para > total_final:
        calculated_troco = data.troco_para - total_final
        lines.append(f"TROCO: {_format_curr(calculated_troco)}")

    # Observação específica da entrega (ex: "Entregar pela porta dos fundos")
    if data.observacao_entrega:
        lines.append(_separator("-", w))
        for wrap_line in textwrap.wrap(f"OBS: {data.observacao_entrega.upper()}", width=w):
            lines.append(wrap_line)

    lines.append(_separator("-", w))
    return "\n".join(lines)
