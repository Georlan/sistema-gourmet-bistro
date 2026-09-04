from __future__ import annotations

import datetime
import textwrap
from dataclasses import dataclass
from typing import Optional

from ...domain.printing import PrintItem
from ...printer_service import (
    ESC_BOLD_OFF,
    ESC_BOLD_ON,
    ESC_DOUBLE_HEIGHT_ON,
    ESC_NORMAL_SIZE,
    align_center,
    mask_phone,
    printer_service,
    split_justified,
)
from ...timezone_utils import to_operational_local_time


@dataclass(frozen=True)
class ComandaVariant:
    """Contexto que varia sem criar outro layout de comanda operacional."""

    origin_label: Optional[str] = None
    location_label: Optional[str] = "BALCÃO"
    operator_label: str = "OPERADOR"
    customer_name: Optional[str] = None
    is_reprint: bool = False
    event_at: Optional[datetime.datetime] = None
    via_label: Optional[str] = None
    table_id: Optional[int] = None
    preserve_item_customers: bool = False
    delivery_phone: Optional[str] = None
    delivery_address: Optional[str] = None
    delivery_neighborhood: Optional[str] = None
    payment_method: Optional[str] = None
    change_for: Optional[float] = None
    delivery_fee: float = 0.0


def _format_brl(value: float) -> str:
    return f"R$ {float(value or 0.0):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _order_type_label(tipo: object) -> str:
    normalized = str(tipo or "").strip().casefold()
    if any(term in normalized for term in ("delivery", "entrega")):
        return "DELIVERY"
    if any(term in normalized for term in ("retir", "viagem", "balc")):
        return "RETIRADA"
    return "CONSUMO NO LOCAL"


def _to_receipt_item(item: PrintItem, *, preserve_customer: bool = False) -> dict:
    return {
        "codigo": item.codigo,
        "produto": {"id": item.codigo, "nome": item.nome},
        "preco_unit": float(item.preco_unit or 0.0),
        "status": "preparando",
        # Remotos exibem cliente no bloco contextual. No salão, a identidade por
        # item precisa ser preservada para mesas divididas por cliente.
        "cliente_nome": (
            item.cliente_nome or "Consumo Geral"
            if preserve_customer
            else "Consumo Geral"
        ),
        "observacao": item.observacao or "",
        "quantidade": max(int(item.quantidade or 1), 1),
    }


def _clean_esc_text(value: str) -> str:
    return (
        str(value or "")
        .replace(ESC_BOLD_ON, "")
        .replace(ESC_BOLD_OFF, "")
        .replace(ESC_DOUBLE_HEIGHT_ON, "")
        .replace(ESC_NORMAL_SIZE, "")
        .strip()
    )


def _style_document_title(
    lines: list[str],
    *,
    document_title: Optional[str],
    width: int,
) -> None:
    """Destaca títulos de documentos sem criar um segundo sistema visual."""
    target = str(document_title or "").strip()
    if not target:
        return
    normalized = target.casefold()
    for index, line in enumerate(lines):
        if _clean_esc_text(line).casefold() != normalized:
            continue
        lines[index] = (
            ESC_DOUBLE_HEIGHT_ON
            + ESC_BOLD_ON
            + align_center(target.upper(), width)
            + ESC_BOLD_OFF
            + ESC_NORMAL_SIZE
        )
        break


def _replace_metadata_line(
    lines: list[str],
    *,
    order_number: Optional[object],
    event_at: Optional[datetime.datetime],
    operator_label: str,
    operator_name: Optional[str],
    location_label: Optional[str],
    identity_label: str,
    width: int,
) -> None:
    """Aplica a hierarquia operacional sobre a base compartilhada da comanda.

    A identidade principal vira o primeiro ponto de leitura. Quando a base contém
    uma mesa, ela é preservada em linha própria; pedidos remotos não carregam o
    antigo texto ``SEM MESA``. Canal é acrescentado somente quando o contexto
    semântico o fornece.
    """
    local_event = event_at
    if isinstance(local_event, datetime.datetime) and local_event.tzinfo is not None:
        local_event = to_operational_local_time(local_event) or local_event

    for index, line in enumerate(lines):
        if "PEDIDO: #" not in line:
            continue
        resolved_order = str(order_number).strip() if order_number is not None else ""
        if not resolved_order:
            tail = line.split("PEDIDO: #", 1)[1]
            for marker in ("MESA:", "SEM MESA"):
                if marker in tail:
                    tail = tail.split(marker, 1)[0]
                    break
            resolved_order = _clean_esc_text(tail)

        table_label: Optional[str] = None
        if "MESA:" in line:
            table_label = "MESA: " + _clean_esc_text(line.split("MESA:", 1)[1])

        resolved_label = str(identity_label or "PEDIDO").strip().upper() or "PEDIDO"
        separator = ":" if resolved_label in {"CONTA", "CONTAS"} else ""
        lines[index] = (
            ESC_DOUBLE_HEIGHT_ON
            + ESC_BOLD_ON
            + align_center(f"{resolved_label}{separator} #{resolved_order}", width)
            + ESC_BOLD_OFF
            + ESC_NORMAL_SIZE
        )
        if table_label:
            lines.insert(index + 1, ESC_BOLD_ON + table_label + ESC_BOLD_OFF)
        break

    if isinstance(local_event, datetime.datetime):
        for index, line in enumerate(lines):
            if "DATA:" in line and "HORA:" in line:
                lines[index] = split_justified(
                    f"DATA: {local_event.strftime('%d/%m/%Y')}",
                    f"HORA: {local_event.strftime('%H:%M')}",
                    width,
                )
                break

    for index, line in enumerate(lines):
        if "GARÇOM:" not in line:
            continue
        operator_text = (
            f"{str(operator_label or 'OPERADOR').strip().upper()}: "
            f"{str(operator_name or 'OPERADOR').strip()}"
        )
        if location_label:
            channel_text = f"CANAL: {str(location_label).strip().upper()}"
            lines[index] = split_justified(operator_text, channel_text, width)
        else:
            lines[index] = operator_text
        break


def _insert_variant_header(
    lines: list[str],
    *,
    tipo: str,
    variant: ComandaVariant,
    width: int,
) -> None:
    order_type = _order_type_label(tipo)
    type_index = next(
        (index for index, line in enumerate(lines) if order_type in line),
        None,
    )
    if type_index is None:
        return

    extras: list[str] = []
    if variant.origin_label:
        extras.append(align_center(f"ORIGEM: {variant.origin_label.upper()}", width))
    if variant.via_label:
        extras.append(align_center(f"VIA: {variant.via_label.upper()}", width))
    if variant.is_reprint:
        extras.append(
            ESC_BOLD_ON + align_center("REIMPRESSÃO", width) + ESC_BOLD_OFF
        )
    if extras:
        lines[type_index + 1:type_index + 1] = extras


def _insert_context_block(
    lines: list[str],
    *,
    variant: ComandaVariant,
    width: int,
) -> None:
    items_index = next(
        (index for index, line in enumerate(lines) if "ITENS" in line),
        None,
    )
    if items_index is None:
        return

    block: list[str] = []
    if variant.customer_name:
        customer_lines = textwrap.wrap(
            f"CLIENTE: {variant.customer_name.upper()}",
            width=width,
            break_long_words=True,
            break_on_hyphens=False,
        ) or ["CLIENTE: NÃO INFORMADO"]
        block.extend(
            ESC_BOLD_ON + customer_line + ESC_BOLD_OFF
            for customer_line in customer_lines
        )

    has_delivery_data = any(
        (
            variant.delivery_phone,
            variant.delivery_address,
            variant.delivery_neighborhood,
            variant.payment_method,
            variant.change_for,
        )
    )
    if has_delivery_data:
        if block:
            block.append("-" * width)
        block.append(ESC_BOLD_ON + "DADOS DA ENTREGA" + ESC_BOLD_OFF)
        if variant.delivery_phone:
            block.append(f"TELEFONE: {mask_phone(variant.delivery_phone)}")
        if variant.delivery_address:
            wrapped = textwrap.wrap(
                f"ENDEREÇO: {variant.delivery_address}",
                width=width,
                break_long_words=True,
                break_on_hyphens=False,
            ) or ["ENDEREÇO: NÃO INFORMADO"]
            block.extend(wrapped)
        if variant.delivery_neighborhood:
            block.append(f"BAIRRO: {variant.delivery_neighborhood}")
        if variant.payment_method:
            block.append(f"PAGAMENTO: {variant.payment_method.upper()}")
        if variant.change_for is not None and float(variant.change_for or 0.0) > 0:
            block.append(f"TROCO PARA: {_format_brl(float(variant.change_for))}")

    if block:
        block.extend(["-" * width, ""])
        lines[items_index:items_index] = block


def _style_items_header(lines: list[str], *, width: int) -> None:
    for index, line in enumerate(lines):
        if line == ESC_BOLD_ON + "ITENS" + ESC_BOLD_OFF:
            lines[index] = (
                ESC_BOLD_ON
                + split_justified("ITENS", "VALOR", width)
                + ESC_BOLD_OFF
            )
            break


def apply_operational_visual_hierarchy(
    receipt: str,
    *,
    order_number: Optional[object] = None,
    event_at: Optional[datetime.datetime] = None,
    operator_label: str = "GARÇOM",
    operator_name: Optional[str] = None,
    location_label: Optional[str] = None,
    identity_label: str = "PEDIDO",
    document_title: Optional[str] = None,
) -> str:
    """Aplica o sistema visual compartilhado a qualquer documento operacional."""
    width = int(getattr(printer_service, "width", 40) or 40)
    lines = receipt.split("\n")
    _style_document_title(
        lines,
        document_title=document_title,
        width=width,
    )
    _replace_metadata_line(
        lines,
        order_number=order_number,
        event_at=event_at,
        operator_label=operator_label,
        operator_name=operator_name,
        location_label=location_label,
        identity_label=identity_label,
        width=width,
    )
    _style_items_header(lines, width=width)
    return "\n".join(lines)


def _replace_total(
    lines: list[str],
    *,
    items: list[PrintItem],
    variant: ComandaVariant,
    width: int,
) -> None:
    total_index = next(
        (index for index, line in enumerate(lines) if "TOTAL GERAL DA MESA:" in line),
        None,
    )
    if total_index is None:
        return

    items_total = sum(float(item.total) for item in items)
    delivery_fee = max(float(variant.delivery_fee or 0.0), 0.0)
    if delivery_fee > 0:
        charge_lines = [
            split_justified("SUBTOTAL ITENS:", _format_brl(items_total), width),
            split_justified("TAXA DE ENTREGA:", _format_brl(delivery_fee), width),
            "-" * width,
        ]
        lines[total_index:total_index] = charge_lines
        total_index += len(charge_lines)

    replacement = split_justified(
        "TOTAL DO PEDIDO:",
        _format_brl(items_total + delivery_fee),
        width,
    )
    lines[total_index] = ESC_BOLD_ON + replacement + ESC_BOLD_OFF


def render_canonical_comanda(
    *,
    restaurant_name: str,
    restaurant_name_position: str,
    print_footer: Optional[str],
    order_number: object,
    order_type: str,
    operator_name: str,
    items: list[PrintItem],
    variant: ComandaVariant,
) -> str:
    """Fonte única do layout de toda comanda operacional do Kôma.

    Consumo local, retirada e delivery passam por este renderer. Os motores só
    resolvem dados e contexto; cabeçalho, identidade, itens, valores, observações,
    total e rodapé pertencem a esta função. Documentos semanticamente diferentes
    (fechamento, caixa, despacho e delta de item) permanecem fora deste modelo.
    """
    width = int(getattr(printer_service, "width", 40) or 40)
    receipt = printer_service.generate_receipt(
        num_pedido=order_number,
        tipo=order_type,
        mesa_id=variant.table_id,
        garcom_nome=operator_name,
        comandas_details=[
            {
                "identificador": "Consumo Geral",
                "itens": [
                    _to_receipt_item(
                        item,
                        preserve_customer=variant.preserve_item_customers,
                    )
                    for item in items
                ],
            }
        ],
        print_header=restaurant_name,
        print_footer=print_footer,
        taxa_servico_ativa=False,
        apenas_valores=False,
        restaurant_name_position=restaurant_name_position,
    )
    receipt = apply_operational_visual_hierarchy(
        receipt,
        order_number=order_number,
        event_at=variant.event_at,
        operator_label=variant.operator_label,
        operator_name=operator_name,
        location_label=variant.location_label,
    )
    lines = receipt.split("\n")
    _insert_variant_header(lines, tipo=order_type, variant=variant, width=width)
    _insert_context_block(lines, variant=variant, width=width)
    _replace_total(lines, items=items, variant=variant, width=width)
    return "\n".join(lines)
