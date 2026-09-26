"""Conversão segura de cupons de texto para bytes ESC/POS."""

import re
import textwrap
from typing import Any, Final, Mapping

from thermal_layout import apply_layout_profile


INITIALIZE: Final[bytes] = b"\x1b@"
# ESC t 3 seleciona PC860, a tabela portuguesa documentada pelo ESC/POS.
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
    """
    Prepara um trabalho RAW independente do sistema operacional.

    O PostgreSQL não aceita bytes NUL em colunas TEXT. O backend transporta
    esses bytes como a sequência literal ``\\x00`` e o agente os restaura aqui.
    O marcador visual ``[CUT]`` nunca deve chegar ao papel.
    """
    resolved_columns = int(
        _profile_value(profile_options, "columns", columns or 0) or 0
    ) or columns
    legacy_compact = bool(
        _profile_value(profile_options, "compact_layout", False)
    )
    layout_mode = str(
        _profile_value(
            profile_options,
            "layout_mode",
            "compact" if legacy_compact else "standard",
        )
        or ("compact" if legacy_compact else "standard")
    )
    charset_mode = str(
        _profile_value(profile_options, "charset_mode", "native")
        or "native"
    )
    supports_cut = bool(
        _profile_value(profile_options, "supports_cut", True)
    )
    allow_double_height = bool(
        _profile_value(profile_options, "allow_double_height", True)
    )
    feed_lines = int(
        _profile_value(profile_options, "feed_lines", 3) or 3
    )
    feed_lines = max(1, min(feed_lines, 6))

    # Ordem importante: restaura o NUL antes de interpretar os controles
    # ESC/POS. Isso elimina o texto literal "x00" sem alterar o protocolo.
    restored = (payload_text or "").replace("\\x00", "\x00")
    profiled = apply_layout_profile(
        restored,
        columns=int(resolved_columns or 48),
        layout_mode=layout_mode,
        charset_mode=charset_mode,
        allow_double_height=allow_double_height,
    )
    fitted = fit_text_to_columns(profiled, resolved_columns)

    normalized = fitted.replace(SIMULATED_CUT_MARKER, "")
    body = normalized.encode(encoding, errors="replace")
    trailer = (b"\n" * feed_lines) + (
        PARTIAL_CUT if supports_cut else b""
    )
    return INITIALIZE + PORTUGUESE_CODE_PAGE + body + trailer
