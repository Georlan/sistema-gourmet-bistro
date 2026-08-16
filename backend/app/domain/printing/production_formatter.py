from typing import List

from ...timezone_utils import get_operational_now
from .models import OrderPrintData
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


def _format_curr(value: float) -> str:
    return f"{value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def format_production_document(
    data: OrderPrintData,
    width: PaperWidth = PaperWidth.WIDTH_80MM,
) -> str:
    """Gera uma ordem de produção estritamente a partir dos itens recebidos.

    Este formatter não consulta mesa, não recompõe consumo anterior e não é
    usado como Extrato Completo. A via financeira de Consumo no Local pertence
    a ``services.printing.render_table_receipt``. Aqui ficam apenas documentos
    incrementais destinados à operação de produção (cozinha/bar/delivery).
    """
    w = width.value if isinstance(width, PaperWidth) else int(width)
    lines: List[str] = []
    now = get_operational_now()
    restaurante = (data.restaurante_nome or "KÔMA").upper()
    lines.append(_center(restaurante, w))

    ped_num = str(data.numero_pedido).strip()
    ped_str = (
        f"PED #{ped_num}"
        if ped_num and not ped_num.startswith("#")
        else f"PED {ped_num}"
        if ped_num
        else ""
    )
    mesa_val = str(data.mesa).strip() if data.mesa else ""
    mesa_str = (
        f"MESA {mesa_val}"
        if mesa_val and not mesa_val.upper().startswith("MESA")
        else mesa_val.upper()
    )
    if ped_str and mesa_str:
        lines.append(_justify(ped_str, mesa_str, w))
    elif ped_str:
        lines.append(ped_str)
    elif mesa_str:
        lines.append(mesa_str)

    tipo_str = (data.tipo_pedido or "LOCAL").upper()
    horario_str = data.horario or now.strftime("%H:%M")
    if tipo_str and horario_str:
        lines.append(_justify(tipo_str, horario_str, w))
    elif tipo_str:
        lines.append(tipo_str)
    if data.garcom_nome:
        lines.append(_center(f"GARÇOM: {data.garcom_nome.upper()}", w))
    lines.append(_separator("-", w))

    prod_items = [
        item
        for item in data.itens
        if (item.destino_impressao or "COZINHA").upper() not in ("NENHUM", "NONE", "")
    ]
    by_client = group_items_by_customer(prod_items)
    omit_client_header = len(by_client) == 1 and "GERAL" in by_client

    first_block = True
    for client_name, client_items in by_client.items():
        if not client_items:
            continue
        if not first_block and not omit_client_header:
            lines.append(_separator("-", w))
        first_block = False
        if not omit_client_header:
            lines.append(client_name)

        for item in group_equivalent_items(client_items, match_observations=True):
            code_str = f"{item.codigo} - " if item.codigo else ""
            left = f"{item.quantidade} x {code_str}{item.nome.upper()}".strip()
            right = f"R$ {_format_curr(item.total)}"
            lines.append(_justify(left, right, w))
            observation = normalize_observation(item.observacao)
            if observation:
                lines.append(f"   {observation.upper()}")

    lines.append(_separator("-", w))
    return "\n".join(lines)
