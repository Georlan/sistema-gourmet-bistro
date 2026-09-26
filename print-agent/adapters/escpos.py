"""Conversão segura de cupons de texto para bytes ESC/POS."""

import re
import textwrap
from typing import Final


INITIALIZE: Final[bytes] = b"\x1b@"
# ESC t 3 seleciona PC860, a tabela portuguesa documentada pelo ESC/POS.
PORTUGUESE_CODE_PAGE: Final[bytes] = b"\x1bt\x03"
PAPER_FEED: Final[bytes] = b"\n\n\n"
PARTIAL_CUT: Final[bytes] = b"\x1d\x56\x42\x00"
ESC_FONT_A: Final[str] = "\x1bM\x00"
ESC_FONT_B: Final[str] = "\x1bM\x01"
SIMULATED_CUT_MARKER: Final[str] = "[CUT]"

_EDGE_CONTROL_RE: Final[re.Pattern[str]] = re.compile(
    r"(?:\x1b(?:M|E|!|3).)"
)
_ANY_CONTROL_RE: Final[re.Pattern[str]] = re.compile(
    r"\x1b(?:M|E|!|3)."
)


def _visible_text(value: str) -> str:
    return _ANY_CONTROL_RE.sub("", value or "")


def _edge_controls(line: str) -> tuple[str, str, str]:
    """Separa comandos ESC/POS que envolvem a linha do texto visível."""
    rest = line
    leading_parts: list[str] = []
    while True:
        match = _EDGE_CONTROL_RE.match(rest)
        if not match:
            break
        leading_parts.append(match.group(0))
        rest = rest[match.end():]

    trailing_parts: list[str] = []
    while rest:
        match = re.search(r"\x1b(?:M|E|!|3).$", rest)
        if not match:
            break
        trailing_parts.insert(0, match.group(0))
        rest = rest[:match.start()]

    visible = _visible_text(rest)
    return "".join(leading_parts), visible, "".join(trailing_parts)


def _source_columns(payload_text: str) -> int:
    """Infere a largura lógica usada pelo renderer original."""
    candidates: list[int] = []
    for raw_line in (payload_text or "").splitlines():
        visible = _visible_text(raw_line)
        stripped = visible.strip()
        if stripped and len(set(stripped)) == 1 and stripped[0] in "-=":
            candidates.append(len(stripped))
    if candidates:
        return max(candidates)

    visible_lengths = [
        len(_visible_text(line))
        for line in (payload_text or "").splitlines()
        if _visible_text(line).strip()
    ]
    return max(visible_lengths, default=0)


def _wrap_visible_line(visible: str, columns: int, source_columns: int) -> list[str]:
    if not visible:
        return [""]

    stripped = visible.strip()
    if not stripped:
        return [""]

    # Separadores devem sempre ocupar exatamente a largura física disponível.
    if len(set(stripped)) == 1 and stripped[0] in "-=":
        return [stripped[0] * columns]

    left_padding = len(visible) - len(visible.lstrip(" "))
    right_padding = len(visible) - len(visible.rstrip(" "))

    # Linhas centralizadas pelo backend são recentralizadas no novo papel.
    if (
        left_padding > 0
        and right_padding > 0
        and abs(left_padding - right_padding) <= 2
        and len(stripped) <= columns
    ):
        return [stripped.center(columns)]

    # Linhas justificadas (item + valor, data + hora, etc.) preservam as duas
    # pontas quando couberem. O backend costuma criar um vão largo entre elas.
    inner = visible.strip()
    gaps = list(re.finditer(r" {2,}", inner))
    if gaps:
        gap = max(gaps, key=lambda match: len(match.group(0)))
        left = inner[:gap.start()].rstrip()
        right = inner[gap.end():].lstrip()
        if left and right:
            if len(left) + len(right) + 1 <= columns:
                return [left.ljust(columns - len(right)) + right]
            wrapped_left = textwrap.wrap(
                left,
                width=columns,
                break_long_words=True,
                break_on_hyphens=False,
            ) or [left[:columns]]
            if len(right) <= columns:
                wrapped_left.append(right.rjust(columns))
            else:
                wrapped_left.extend(
                    textwrap.wrap(
                        right,
                        width=columns,
                        break_long_words=True,
                        break_on_hyphens=False,
                    )
                )
            return wrapped_left

    if len(visible) <= columns:
        return [visible]

    indent = min(left_padding, max(columns - 1, 0))
    prefix = " " * indent
    available = max(columns - indent, 1)
    wrapped = textwrap.wrap(
        stripped,
        width=available,
        break_long_words=True,
        break_on_hyphens=False,
    ) or [stripped[:available]]
    return [prefix + part for part in wrapped]


def fit_text_to_columns(payload_text: str, columns: int | None) -> str:
    """Adapta a comanda canônica à largura física sem conhecer o transporte."""
    # O backend escapa NUL antes de persistir no PostgreSQL. Restaure ANTES de
    # interpretar ESC/POS; caso contrário o parser consome a barra de "\\x00"
    # como parâmetro do comando e imprime o texto residual "x00".
    working = (payload_text or "").replace("\\x00", "\x00")
    if not columns or columns <= 0:
        return working

    source_columns = _source_columns(working)
    if source_columns and columns >= source_columns:
        return working

    output: list[str] = []
    for raw_line in working.split("\n"):
        leading, visible, trailing = _edge_controls(raw_line)
        wrapped = _wrap_visible_line(visible, columns, source_columns)
        if not wrapped:
            output.append(leading + trailing)
            continue
        wrapped[0] = leading + wrapped[0]
        wrapped[-1] = wrapped[-1] + trailing
        output.extend(wrapped)
    return "\n".join(output)


def _compact_vertical_whitespace(payload_text: str) -> str:
    """Remove linhas vazias decorativas em perfis compactos."""
    return "\n".join(
        line
        for line in (payload_text or "").split("\n")
        if _visible_text(line).strip()
    )


def _apply_physical_profile(
    payload_text: str,
    *,
    font_mode: str,
    line_spacing_dots: int | None,
    compact_whitespace: bool,
) -> str:
    result = payload_text
    if compact_whitespace:
        result = _compact_vertical_whitespace(result)

    if str(font_mode or "a").casefold() == "b":
        result = result.replace(ESC_FONT_A, ESC_FONT_B)

    if line_spacing_dots is not None:
        safe_spacing = max(1, min(int(line_spacing_dots), 255))
        result = re.sub(
            r"\x1b3.",
            "\x1b3" + chr(safe_spacing),
            result,
        )
    return result


def _code_page_command(code_page: int) -> bytes:
    return b"\x1bt" + bytes([max(0, min(int(code_page), 255))])


def build_escpos_payload(
    payload_text: str,
    encoding: str = "cp860",
    *,
    columns: int | None = None,
    code_page: int = 3,
    font_mode: str = "a",
    line_spacing_dots: int | None = None,
    feed_lines: int = 3,
    compact_whitespace: bool = False,
) -> bytes:
    """
    Prepara um trabalho RAW independente do sistema operacional.

    O PostgreSQL não aceita bytes NUL em colunas TEXT. O backend transporta
    esses bytes como a sequência literal ``\\x00`` e o agente os restaura aqui.
    O marcador visual ``[CUT]`` nunca deve chegar ao papel.
    """
    fitted = fit_text_to_columns(payload_text or "", columns)
    profiled = _apply_physical_profile(
        fitted,
        font_mode=font_mode,
        line_spacing_dots=line_spacing_dots,
        compact_whitespace=compact_whitespace,
    )
    normalized = profiled.replace(SIMULATED_CUT_MARKER, "")
    try:
        body = normalized.encode(encoding, errors="replace")
    except LookupError:
        body = normalized.encode("cp860", errors="replace")

    safe_feed_lines = max(1, min(int(feed_lines or 3), 6))
    return (
        INITIALIZE
        + _code_page_command(code_page)
        + body
        + (b"\n" * safe_feed_lines)
        + PARTIAL_CUT
    )
