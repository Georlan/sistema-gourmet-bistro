"""Compositor de layout térmico por capacidades do endpoint.

A origem do documento continua única no backend. Este módulo não conhece
clientes, restaurantes nem transportes; ele adapta a mesma fonte canônica a
classes físicas de impressora (ex.: 58 mm compacto ou 80 mm padrão).
"""

from __future__ import annotations

import re
import unicodedata

ESC_BOLD_ON = "\x1bE\x01"
ESC_BOLD_OFF = "\x1bE\x00"
ESC_DOUBLE_HEIGHT_ON = "\x1b!\x10"
ESC_NORMAL_SIZE = "\x1b!\x00"

_CONTROL_RE = re.compile(r"\x1b(?:M|E|!|3).")


def _visible(line: str) -> str:
    return _CONTROL_RE.sub("", line or "").strip()


def _ascii_safe(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value or "")
    return normalized.encode("ascii", errors="ignore").decode("ascii")


def _split_justified(left: str, right: str, width: int) -> str:
    left = str(left or "").strip()
    right = str(right or "").strip()
    if not right:
        return left[:width]
    if len(left) + len(right) + 1 > width:
        return f"{left} {right}"[:width]
    return left + (" " * (width - len(left) - len(right))) + right


def _replace_closing_metadata(lines: list[str], *, width: int, compact: bool) -> list[str]:
    """Compõe metadados sem ambiguidade entre conta, abertura e hora de impressão."""
    indexes: dict[str, int] = {}
    values: dict[str, str] = {}
    for index, line in enumerate(lines):
        clean = _visible(line)
        for key in ("MESA:", "CONTA:", "CONTAS:", "ABERTA:", "IMPRESSA:", "OPERADOR:"):
            if clean.startswith(key):
                indexes[key] = index
                values[key] = clean[len(key):].strip()

    required = {"MESA:", "ABERTA:", "IMPRESSA:", "OPERADOR:"}
    account_key = "CONTAS:" if "CONTAS:" in indexes else "CONTA:" if "CONTA:" in indexes else None
    if not required.issubset(indexes) or account_key is None:
        return lines

    first = min(indexes[key] for key in (*required, account_key))
    last = max(indexes[key] for key in (*required, account_key))

    mesa = values["MESA:"]
    conta = values[account_key]
    aberta = values["ABERTA:"]
    impressa = values["IMPRESSA:"]
    operador = values["OPERADOR:"]

    date_match = re.match(r"(\d{2}/\d{2}/\d{4})\s+(\d{2}:\d{2})$", impressa)
    if date_match:
        print_date, print_time = date_match.groups()
    else:
        print_date, print_time = "", impressa

    account_label = "CONTAS" if account_key == "CONTAS:" else "CONTA"
    if compact:
        new_lines = [
            ESC_BOLD_ON + _split_justified(f"MESA {mesa}", f"{account_label} {conta}", width) + ESC_BOLD_OFF,
            _split_justified(f"ABERTA {aberta}", f"IMP {print_time}", width),
        ]
        if print_date:
            short_date = print_date[:6] + print_date[-2:]
            new_lines.append(f"DATA {short_date}")
        new_lines.append(f"OP {operador}"[:width])
    else:
        new_lines = [
            ESC_BOLD_ON + _split_justified(f"MESA: {mesa}", f"{account_label}: {conta}", width) + ESC_BOLD_OFF,
            _split_justified(f"ABERTA: {aberta}", f"IMPRESSA: {impressa}", width),
            f"OPERADOR: {operador}"[:width],
        ]

    return lines[:first] + new_lines + lines[last + 1:]


def _compact_order_metadata(lines: list[str], *, width: int) -> list[str]:
    """Une mesa/pedido e simplifica data/hora sem perder identidade."""
    output: list[str] = []
    index = 0
    while index < len(lines):
        current = _visible(lines[index])
        nxt = _visible(lines[index + 1]) if index + 1 < len(lines) else ""

        if current.startswith("MESA:") and (
            nxt.startswith("PEDIDO ") or nxt.startswith("PEDIDOS ")
        ):
            mesa = current.split(":", 1)[1].strip()
            identity = nxt
            output.append(
                ESC_BOLD_ON
                + _split_justified(f"MESA {mesa}", identity, width)
                + ESC_BOLD_OFF
            )
            index += 2
            continue

        if current == "REIMPRESSÃO" and nxt == "VIA COMPLETA DA MESA":
            output.append(ESC_BOLD_ON + "REIMPRESSÃO | VIA COMPLETA".center(width) + ESC_BOLD_OFF)
            index += 2
            continue

        if "DATA:" in current and "HORA:" in current:
            date_match = re.search(r"DATA:\s*(\d{2}/\d{2}/\d{4})", current)
            time_match = re.search(r"HORA:\s*(\d{2}:\d{2})", current)
            if date_match and time_match:
                date = date_match.group(1)
                output.append(f"{date[:6]}{date[-2:]} {time_match.group(1)}".center(width))
                index += 1
                continue

        if current.startswith("GARÇOM:") or current.startswith("GARCOM:"):
            operator = current.split(":", 1)[1].strip()
            output.append(f"OPERADOR: {operator}"[:width])
            index += 1
            continue

        output.append(lines[index])
        index += 1
    return output


def _shorten_compact_labels(lines: list[str], *, width: int) -> list[str]:
    replacements = (
        ("FECHAMENTO DA MESA", "FECHAMENTO"),
        ("TOTAL GERAL DA MESA:", "TOTAL DA MESA:"),
        ("SUBTOTAL CONSUMO GERAL", "SUBTOTAL GERAL"),
        ("Gerenciado por Kôma", "Gerenciado por Koma"),
        ("Documento não fiscal", "DOCUMENTO NAO FISCAL"),
    )
    result: list[str] = []
    for line in lines:
        adapted = line
        for source, target in replacements:
            adapted = adapted.replace(source, target)
        result.append(adapted)
    return result


def _is_separator(line: str) -> bool:
    clean = _visible(line)
    return bool(clean) and len(set(clean)) == 1 and clean[0] in "-="


def _compact_customer_subtotals(lines: list[str]) -> list[str]:
    """Economiza uma linha por cliente sem remover subtotal individual."""
    result: list[str] = []
    index = 0
    while index < len(lines):
        current = lines[index]
        nxt = _visible(lines[index + 1]) if index + 1 < len(lines) else ""
        if _is_separator(current) and nxt.startswith("SUBTOTAL "):
            # O próprio rótulo SUBTOTAL delimita o fim do cliente. O separador
            # anterior é redundante em bobina estreita; qualquer separador
            # posterior continua sendo preservado normalmente.
            index += 1
            continue

        result.append(current)
        index += 1
    return result


def _drop_decorative_blank_lines(lines: list[str]) -> list[str]:
    result: list[str] = []
    for line in lines:
        if not _visible(line) and not _CONTROL_RE.search(line):
            continue
        result.append(line)
    return result


def apply_layout_profile(
    payload_text: str,
    *,
    columns: int,
    layout_mode: str = "standard",
    charset_mode: str = "native",
    allow_double_height: bool = True,
) -> str:
    """Adapta a fonte canônica ao perfil físico sem regras por cliente/modelo."""
    width = max(int(columns or 0), 1)
    compact = str(layout_mode or "standard").casefold() == "compact"

    text = payload_text or ""
    if compact and not allow_double_height:
        text = text.replace(ESC_DOUBLE_HEIGHT_ON, ESC_NORMAL_SIZE)

    lines = text.split("\n")
    lines = _replace_closing_metadata(lines, width=width, compact=compact)

    if compact:
        lines = _compact_order_metadata(lines, width=width)
        lines = _shorten_compact_labels(lines, width=width)
        lines = _compact_customer_subtotals(lines)
        lines = _drop_decorative_blank_lines(lines)

    rendered = "\n".join(lines)
    if str(charset_mode or "native").casefold() == "ascii_safe":
        rendered = _ascii_safe(rendered)
    return rendered
