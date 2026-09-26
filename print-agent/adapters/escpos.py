"""Conversão segura de cupons de texto para bytes ESC/POS."""

import re
import textwrap
import unicodedata
from typing import Any, Final, Mapping


INITIALIZE: Final[bytes] = b"\x1b@"
# ESC t 3 seleciona PC860, a tabela portuguesa documentada pelo ESC/POS.
PORTUGUESE_CODE_PAGE: Final[bytes] = b"\x1bt\x03"
PAPER_FEED: Final[bytes] = b"\n\n\n"
PARTIAL_CUT: Final[bytes] = b"\x1d\x56\x42\x00"
SIMULATED_CUT_MARKER: Final[str] = "[CUT]"
DOUBLE_HEIGHT_ON: Final[str] = "\x1b!\x10"
NORMAL_SIZE: Final[str] = "\x1b!\x00"

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


def _preserve_controls(line: str, visible: str) -> str:
    leading, _, trailing = _edge_controls(line)
    return leading + visible + trailing


def _compact_pair(left: str, right: str, columns: int) -> list[str]:
    left = str(left or "").strip()
    right = str(right or "").strip()
    if left and right and len(left) + len(right) + 1 <= columns:
        return [left.ljust(columns - len(right)) + right]
    return [part for part in (left, right) if part]


def _project_compact_semantics(payload_text: str, columns: int) -> str:
    """Projeta o documento canônico para uma bobina compacta.

    O backend continua sendo a única fonte do documento. Esta etapa só muda
    apresentação conforme as capabilities físicas: remove redundâncias, deixa
    horários semanticamente explícitos e preserva itens/totais/clientes.
    """
    lines = (payload_text or "").split("\n")
    visible = [_visible_text(line).strip() for line in lines]

    # A segunda via já carrega REIMPRESSÃO; esta frase é redundante em 58 mm.
    lines = [
        line
        for line, text in zip(lines, visible)
        if text.casefold() != "via completa da mesa"
    ]
    visible = [_visible_text(line).strip() for line in lines]

    # O cabeçalho de valores é operacionalmente um fechamento/conta da mesa.
    for idx, text in enumerate(visible):
        if text.casefold() == "conta da mesa":
            source_width = max(_source_columns(payload_text), columns)
            lines[idx] = _preserve_controls(
                lines[idx],
                "FECHAMENTO DA MESA".center(source_width),
            )
            visible[idx] = "FECHAMENTO DA MESA"
            break

    mesa_idx = next(
        (
            idx for idx, text in enumerate(visible)
            if "MESA:" in text and "ABERTURA:" in text
        ),
        None,
    )
    account_idx = next(
        (
            idx for idx, text in enumerate(visible)
            if re.match(r"^CONTAS?:\s*#", text, flags=re.IGNORECASE)
        ),
        None,
    )
    date_idx = next(
        (
            idx for idx, text in enumerate(visible)
            if "DATA:" in text and "HORA:" in text
        ),
        None,
    )
    operator_idx = next(
        (
            idx for idx, text in enumerate(visible)
            if text.upper().startswith("IMPRESSO POR:")
        ),
        None,
    )

    # No fechamento, números e horários deixam de competir visualmente.
    if (
        mesa_idx is not None
        and account_idx is not None
        and date_idx is not None
        and operator_idx is not None
    ):
        mesa_match = re.search(
            r"MESA:\s*(.+?)\s+ABERTURA:\s*(\d{1,2}:\d{2})",
            visible[mesa_idx],
            flags=re.IGNORECASE,
        )
        date_match = re.search(
            r"DATA:\s*([^\s]+).*?HORA:\s*(\d{1,2}:\d{2})",
            visible[date_idx],
            flags=re.IGNORECASE,
        )
        if mesa_match and date_match:
            table_value = mesa_match.group(1).strip()
            opened_at = mesa_match.group(2).strip()
            account_text = visible[account_idx].strip()
            printed_at = date_match.group(2).strip()
            date_text = date_match.group(1).strip()
            operator = visible[operator_idx].split(":", 1)[1].strip()

            replacement: list[str] = []
            replacement.extend(
                _compact_pair(
                    f"MESA: {table_value}",
                    account_text,
                    columns,
                )
            )
            replacement.extend(
                _compact_pair(
                    f"ABERTA: {opened_at}",
                    f"IMPRESSA: {printed_at}",
                    columns,
                )
            )
            replacement.append(f"DATA: {date_text}")
            replacement.append(f"OPERADOR: {operator}")

            start = min(mesa_idx, account_idx, date_idx, operator_idx)
            end = max(mesa_idx, account_idx, date_idx, operator_idx)
            leading, _, _ = _edge_controls(lines[mesa_idx])
            _, _, trailing = _edge_controls(lines[mesa_idx])
            if replacement:
                replacement[0] = leading + replacement[0]
                replacement[0] += trailing
            lines[start:end + 1] = replacement

    # Em pedidos/reimpressões simples, mesa e pedido cabem na mesma linha.
    visible = [_visible_text(line).strip() for line in lines]
    index = 0
    while index < len(lines) - 1:
        current = visible[index]
        nxt = visible[index + 1]
        if (
            re.match(r"^MESA:\s*\S+$", current, flags=re.IGNORECASE)
            and re.match(r"^PEDIDO\s+#\S+$", nxt, flags=re.IGNORECASE)
        ):
            combined = _compact_pair(current, nxt, columns)
            if len(combined) == 1:
                lines[index:index + 2] = [
                    _preserve_controls(lines[index], combined[0])
                ]
                visible[index:index + 2] = [combined[0]]
                continue
        index += 1

    # O cabeçalho já identifica a marca. Esta assinatura é redundante em 58 mm.
    lines = [
        line
        for line in lines
        if _visible_text(line).strip().casefold() != "gerenciado por kôma".casefold()
    ]

    return "\n".join(lines)


def _apply_charset_policy(payload_text: str, policy: str) -> str:
    """Aplica charset por capability sem tocar em bytes de controle ESC/POS."""
    normalized_policy = str(policy or "native_cp860").strip().lower()
    if normalized_policy != "ascii_safe":
        return payload_text

    decomp = unicodedata.normalize("NFKD", payload_text or "")
    output: list[str] = []
    for char in decomp:
        if unicodedata.combining(char):
            continue
        if ord(char) < 128:
            output.append(char)
            continue
        replacements = {
            "–": "-",
            "—": "-",
            "“": '"',
            "”": '"',
            "‘": "'",
            "’": "'",
            "º": "o",
            "ª": "a",
        }
        replacement = replacements.get(char)
        if replacement:
            output.append(replacement)
    return "".join(output)


def _compact_text_layout(
    payload_text: str,
    *,
    allow_double_height: bool,
) -> str:
    """Compacta somente a estrutura textual, sem introduzir comandos novos.

    Em bobinas estreitas removemos linhas vazias decorativas e, quando o perfil
    não comporta títulos altos com eficiência, trocamos apenas o comando
    double-height já existente pelo comando normal já homologado.
    """
    compacted = payload_text
    if not allow_double_height:
        compacted = compacted.replace(DOUBLE_HEIGHT_ON, NORMAL_SIZE)

    lines: list[str] = []
    for line in compacted.split("\n"):
        visible = _visible_text(line)
        has_control = bool(_ANY_CONTROL_RE.search(line))
        if not visible.strip() and not has_control:
            continue
        lines.append(line)
    return "\n".join(lines)


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
    compact_layout = bool(
        _profile_value(profile_options, "compact_layout", False)
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
    charset_policy = str(
        _profile_value(profile_options, "charset_policy", "native_cp860")
        or "native_cp860"
    ).strip().lower()
    semantic_layout = str(
        _profile_value(profile_options, "semantic_layout", "standard")
        or "standard"
    ).strip().lower()

    # Ordem importante: restaura o NUL antes de interpretar os controles
    # ESC/POS. Isso elimina o texto literal "x00" sem alterar o protocolo.
    restored = (payload_text or "").replace("\\x00", "\x00")
    projected = (
        _project_compact_semantics(restored, int(resolved_columns or 32))
        if semantic_layout == "compact_58"
        else restored
    )
    fitted = fit_text_to_columns(projected, resolved_columns)
    if compact_layout:
        fitted = _compact_text_layout(
            fitted,
            allow_double_height=allow_double_height,
        )
    fitted = _apply_charset_policy(fitted, charset_policy)

    normalized = fitted.replace(SIMULATED_CUT_MARKER, "")
    body = normalized.encode(encoding, errors="replace")
    trailer = (b"\n" * feed_lines) + (
        PARTIAL_CUT if supports_cut else b""
    )
    return INITIALIZE + PORTUGUESE_CODE_PAGE + body + trailer
