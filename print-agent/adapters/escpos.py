"""Conversão segura e adaptativa de cupons de texto para ESC/POS."""

import re
import textwrap
from typing import Any, Final, Mapping


INITIALIZE: Final[bytes] = b"\x1b@"
PORTUGUESE_CODE_PAGE: Final[bytes] = b"\x1bt\x03"
PAPER_FEED: Final[bytes] = b"\n\n\n"
PARTIAL_CUT: Final[bytes] = b"\x1d\x56\x42\x00"
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

    if len(set(stripped)) == 1 and stripped[0] in "-=":
        return [stripped[0] * columns]

    left_padding = len(visible) - len(visible.lstrip(" "))
    right_padding = len(visible) - len(visible.rstrip(" "))

    if (
        left_padding > 0
        and right_padding > 0
        and abs(left_padding - right_padding) <= 2
        and len(stripped) <= columns
    ):
        return [stripped.center(columns)]

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
    if not columns or columns <= 0:
        return payload_text or ""

    source_columns = _source_columns(payload_text)
    if source_columns and columns >= source_columns:
        return payload_text or ""

    output: list[str] = []
    for raw_line in (payload_text or "").split("\n"):
        leading, visible, trailing = _edge_controls(raw_line)
        wrapped = _wrap_visible_line(visible, columns, source_columns)
        if not wrapped:
            output.append(leading + trailing)
            continue
        wrapped[0] = leading + wrapped[0]
        wrapped[-1] = wrapped[-1] + trailing
        output.extend(wrapped)
    return "\n".join(output)


def _rewrite_font_commands(payload_text: str, font_mode: str | None) -> str:
    """Força a fonte do perfil preservando bold, altura e largura."""
    mode = str(font_mode or "").strip().upper()
    if mode not in {"A", "B"}:
        return payload_text

    font_b = mode == "B"
    replacement = "\x01" if font_b else "\x00"
    result = re.sub(r"\x1bM.", "\x1bM" + replacement, payload_text)

    def rewrite_print_mode(match: re.Match[str]) -> str:
        value = ord(match.group(1))
        if font_b:
            value |= 0x01
        else:
            value &= ~0x01
        return "\x1b!" + chr(value)

    return re.sub(r"\x1b!(.)", rewrite_print_mode, result)


def _rewrite_line_spacing(payload_text: str, dots: int | None) -> str:
    if not dots:
        return payload_text
    safe_dots = max(1, min(int(dots), 255))
    command = "\x1b3" + chr(safe_dots)
    if "\x1b3" in payload_text:
        return re.sub(r"\x1b3.", command, payload_text)
    return command + payload_text


def _compact_vertical_whitespace(payload_text: str) -> str:
    """Remove linhas vazias decorativas sem eliminar linhas de comando."""
    output: list[str] = []
    for line in (payload_text or "").split("\n"):
        visible = _visible_text(line)
        has_control = bool(_ANY_CONTROL_RE.search(line))
        if not visible.strip() and not has_control:
            continue
        output.append(line)
    return "\n".join(output)


def _profile_value(
    profile_options: Mapping[str, Any] | None,
    key: str,
    default: Any,
) -> Any:
    if not profile_options:
        return default
    value = profile_options.get(key)
    return default if value is None else value


def build_escpos_payload(
    payload_text: str,
    encoding: str = "cp860",
    *,
    columns: int | None = None,
    profile_options: Mapping[str, Any] | None = None,
) -> bytes:
    """Prepara RAW conforme as capabilities físicas do endpoint.

    O backend persiste bytes NUL como a sequência literal barra-x00. O agente
    restaura esses controles antes do reflow; restaurar depois fazia o parser
    consumir a barra como argumento ESC e imprimir o texto residual x00.
    """
    resolved_columns = int(
        _profile_value(profile_options, "columns", columns or 0) or 0
    ) or columns
    resolved_encoding = str(
        _profile_value(profile_options, "encoding", encoding) or encoding
    )
    code_page = int(_profile_value(profile_options, "code_page", 3) or 3)
    code_page = max(0, min(code_page, 255))
    font_mode = str(_profile_value(profile_options, "font_mode", "") or "")
    line_spacing = _profile_value(profile_options, "line_spacing_dots", None)
    compact_layout = bool(
        _profile_value(profile_options, "compact_layout", False)
    )
    feed_lines = int(_profile_value(profile_options, "feed_lines", 3) or 3)
    feed_lines = max(1, min(feed_lines, 8))

    restored = (payload_text or "").replace("\\x00", "\x00")
    fitted = fit_text_to_columns(restored, resolved_columns)
    fitted = _rewrite_font_commands(fitted, font_mode)
    fitted = _rewrite_line_spacing(fitted, line_spacing)
    if compact_layout:
        fitted = _compact_vertical_whitespace(fitted)

    normalized = fitted.replace(SIMULATED_CUT_MARKER, "")
    body = normalized.encode(resolved_encoding, errors="replace")
    code_page_command = b"\x1bt" + bytes([code_page])
    paper_feed = b"\n" * feed_lines
    return (
        INITIALIZE
        + code_page_command
        + body
        + paper_feed
        + PARTIAL_CUT
    )
