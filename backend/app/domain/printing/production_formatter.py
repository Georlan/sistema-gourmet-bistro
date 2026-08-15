from typing import List
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


def _is_general_client(name: str) -> bool:
    return (name or "").strip().casefold() in {"", "geral", "consumo geral"}


def _printable_name(code: str, name: str) -> str:
    clean_name = (name or "").strip()
    clean_code = (code or "").strip()
    if not clean_code:
        return clean_name
    lowered = clean_name.casefold()
    for prefix in (
        f"{clean_code} - ",
        f"{clean_code}-",
        f"[{clean_code}] ",
        f"[{clean_code}]",
    ):
        if lowered.startswith(prefix.casefold()):
            return clean_name[len(prefix):].lstrip()
    return clean_name


def format_production_document(data: OrderPrintData, width: PaperWidth = PaperWidth.WIDTH_80MM) -> str:
    """Gera a comanda de produção padronizada para pedidos do salão.

    Caixa e garçom usam a mesma estrutura para Consumo no Local. O documento
    mostra valores, agrupa por cliente, omite o bloco de Consumo Geral quando
    ele é o único identificador e preserva observações operacionais.
    """
    w = width.value if isinstance(width, PaperWidth) else int(width)
    lines: List[str] = []

    restaurante = (data.restaurante_nome or "KÔMA").upper()
    lines.append(_center(restaurante, w))
    lines.append(_center((data.tipo_pedido or "CONSUMO NO LOCAL").upper(), w))

    reprint_marker = (data.numero_lancamento or "").strip().upper()
    if reprint_marker in {"REIMPRESSAO", "REIMPRESSÃO"}:
        lines.append(_center("REIMPRESSÃO", w))

    lines.append(_separator("-", w))

    ped_num = str(data.numero_pedido).strip()
    ped_str = (
        f"PEDIDO: #{ped_num}"
        if ped_num and not ped_num.startswith("#")
        else f"PEDIDO: {ped_num}"
        if ped_num
        else ""
    )
    mesa_val = str(data.mesa).strip() if data.mesa else ""
    mesa_str = (
        f"MESA: {mesa_val}"
        if mesa_val and not mesa_val.upper().startswith("MESA")
        else mesa_val.upper()
    )

    if ped_str and mesa_str:
        lines.append(_justify(ped_str, mesa_str, w))
    elif ped_str:
        lines.append(ped_str)
    elif mesa_str:
        lines.append(mesa_str)

    horario_str = data.horario or ""
    if data.garcom_nome and horario_str:
        lines.append(_justify(f"GARÇOM: {data.garcom_nome}", f"HORA: {horario_str}", w))
    elif data.garcom_nome:
        lines.append(f"GARÇOM: {data.garcom_nome}")
    elif horario_str:
        lines.append(f"HORA: {horario_str}")

    lines.append(_separator("-", w))

    prod_items = [
        item
        for item in data.itens
        if (item.destino_impressao or "COZINHA").upper()
        not in ("NENHUM", "NONE", "")
    ]
    by_client = group_items_by_customer(prod_items)

    first_block = True
    for client_name, client_items in by_client.items():
        if not client_items:
            continue
        if not first_block:
            lines.append(_separator("-", w))
        first_block = False

        if not _is_general_client(client_name):
            lines.append(_center(f"CLIENTE: {client_name.upper()}", w))

        for item in group_equivalent_items(client_items, match_observations=True):
            printable_name = _printable_name(item.codigo, item.nome).upper()
            left = f"{item.quantidade}x {printable_name}".strip()
            right = f"R$ {_format_curr(item.total)}"
            lines.append(_justify(left, right, w))

            observation = normalize_observation(item.observacao)
            if observation:
                lines.append(f"   OBS: {observation.upper()}")

    lines.append(_separator("-", w))
    lines.append(_center("Gerenciado por Kôma", w))
    lines.append(_center("Documento não fiscal", w))
    return "\n".join(lines)
