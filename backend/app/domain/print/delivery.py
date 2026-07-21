from typing import List
from .types import DeliveryDocumentData, PaperWidth
from .formatter import center_text, separator, justify_two_columns, format_currency, wrap_text

def format_delivery_document(data: DeliveryDocumentData, width: PaperWidth = PaperWidth.WIDTH_80MM) -> str:
    """
    Formata o documento TIPO 3 - ENTREGA (Motoboy / Delivery).
    
    Regras:
    - NÃO imprime ingredientes.
    - Imprime Pedido #, Horário, Cliente, Telefone.
    - Imprime endereço completo (Logradouro, Bairro, Complemento, Referência).
    - Lista itens com código, nome, quantidade e valores.
    - Imprime Subtotal, Taxa de entrega, Desconto e Total final.
    - Imprime Forma de pagamento e Troco (se houver).
    - Compacto e legível.
    """
    w = width.value if isinstance(width, PaperWidth) else int(width)
    lines: List[str] = []

    # 1. Cabeçalho
    restaurante = (data.restaurante_nome or "KÔMA").upper()
    lines.append(center_text(restaurante, w))

    ped_str = f"PED #{data.numero_pedido}" if data.numero_pedido and not str(data.numero_pedido).startswith("#") else f"PED {data.numero_pedido}" if data.numero_pedido else "PEDIDO"
    lines.append(justify_two_columns(ped_str, "DELIVERY", w))

    if data.data_hora:
        lines.append(center_text(data.data_hora, w))

    lines.append(separator("-", w))

    # 2. Dados do Cliente e Endereço
    if data.cliente_nome:
        lines.append(data.cliente_nome.upper())
    
    if data.cliente_telefone:
        lines.append(data.cliente_telefone)

    if data.logradouro:
        lines.extend(wrap_text(data.logradouro.upper(), w, indent=""))
    
    if data.bairro:
        lines.append(data.bairro.upper())

    if data.complemento:
        lines.extend(wrap_text(data.complemento.upper(), w, indent=""))

    if data.ponto_referencia:
        ref_text = f"REF: {data.ponto_referencia}".upper()
        lines.extend(wrap_text(ref_text, w, indent=""))

    lines.append(separator("-", w))

    # 3. Lista de Itens com Valores
    subtotal_itens = 0.0
    for item in data.itens:
        item_total = item.total
        subtotal_itens += item_total
        
        code_str = f"{item.codigo} " if item.codigo else ""
        left_str = f"{item.quantidade}x {code_str}{item.nome.upper()}".strip()
        right_str = format_currency(item_total)
        lines.append(justify_two_columns(left_str, right_str, w))

    lines.append(separator("-", w))

    # 4. Totais
    lines.append(justify_two_columns("SUBTOTAL", format_currency(subtotal_itens), w))
    
    if data.taxa_entrega > 0.0:
        lines.append(justify_two_columns("TAXA ENTREGA", format_currency(data.taxa_entrega), w))

    if data.desconto > 0.0:
        lines.append(justify_two_columns("DESCONTO", f"-{format_currency(data.desconto)}", w))

    total_final = max(0.0, subtotal_itens + data.taxa_entrega - data.desconto)
    lines.append(separator("-", w))
    lines.append(justify_two_columns("TOTAL", format_currency(total_final), w))
    lines.append("")

    # 5. Forma de Pagamento e Troco
    pag_str = f"PAG: {(data.forma_pagamento or 'DINHEIRO').upper()}"
    lines.append(pag_str)

    if data.valor_troco is not None and data.valor_troco > 0.0:
        lines.append(f"TROCO: {format_currency(data.valor_troco)}")
    elif data.troco_para is not None and data.troco_para > total_final:
        calculated_troco = data.troco_para - total_final
        lines.append(f"TROCO: {format_currency(calculated_troco)}")

    lines.append(separator("-", w))
    lines.append(center_text("OBRIGADO!", w))

    return "\n".join(lines)
