"""Perfis físicos/capabilities para impressão térmica.

O backend produz um documento canônico. O agente escolhe como esse documento
vira ESC/POS conforme as capacidades do endpoint físico. Assim largura de
papel, fonte, code page e densidade vertical não ficam acopladas à G250, à
KA-1445 nem ao transporte usado.
"""

from dataclasses import dataclass
import re
from typing import Any, Mapping


@dataclass(frozen=True)
class PrinterPaperProfile:
    key: str
    paper_width_mm: int
    columns: int
    font_mode: str = "A"
    encoding: str = "cp860"
    code_page: int = 3
    line_spacing_dots: int | None = None
    feed_lines: int = 3
    compact_layout: bool = False
    print_width_dots: int | None = None


DEFAULT_PROFILE = PrinterPaperProfile(
    key="thermal-80mm",
    paper_width_mm=80,
    columns=48,
    font_mode="A",
    encoding="cp860",
    code_page=3,
    line_spacing_dots=None,  # preserva os comandos do renderer legado
    feed_lines=3,
    compact_layout=False,
    print_width_dots=576,
)

COMPACT_58MM_PROFILE = PrinterPaperProfile(
    key="thermal-58mm-compact-v2",
    paper_width_mm=58,
    # 384 dots comportam 42 caracteres em Font B (9 dots/caractere).
    # Isso evita tratar 58 mm como um recibo 80 mm simplesmente quebrado.
    columns=42,
    font_mode="B",
    encoding="cp860",
    code_page=3,
    line_spacing_dots=20,
    feed_lines=2,
    compact_layout=True,
    print_width_dots=384,
)

KNOWN_PROFILES: tuple[tuple[re.Pattern[str], PrinterPaperProfile], ...] = (
    (
        re.compile(r"(?:^|\b)(?:KA[-\s]?1445|KA7)(?:\b|$)", re.IGNORECASE),
        COMPACT_58MM_PROFILE,
    ),
    (
        re.compile(r"(?:^|\b)G[-\s]?250(?:\b|$)", re.IGNORECASE),
        DEFAULT_PROFILE,
    ),
)

_PROFILE_OPTION_NAMES = (
    "paper_profile",
    "paper_width_mm",
    "columns",
    "font_mode",
    "encoding",
    "code_page",
    "line_spacing_dots",
    "feed_lines",
    "compact_layout",
    "print_width_dots",
)


def _positive_int(value: Any) -> int | None:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _known_profile(name: str, display_name: str = "") -> PrinterPaperProfile | None:
    identity = " ".join(
        part
        for part in (
            str(name or "").strip(),
            str(display_name or "").strip(),
        )
        if part
    )
    for pattern, profile in KNOWN_PROFILES:
        if pattern.search(identity):
            return profile
    return None


def infer_printer_paper_profile(
    name: str,
    *,
    display_name: str = "",
    transport: str = "",
    options: Mapping[str, Any] | None = None,
) -> PrinterPaperProfile:
    """Resolve capabilities sem inferir largura a partir de USB/Bluetooth/rede."""
    del transport  # transporte não define capacidade física do mecanismo
    opts = dict(options or {})
    known = _known_profile(name, display_name)
    explicit_width = _positive_int(opts.get("paper_width_mm"))
    explicit_columns = _positive_int(opts.get("columns"))
    explicit_key = str(opts.get("paper_profile") or "").strip()

    # Migra o perfil automático 58 mm da primeira implementação. Ele usava
    # Font A/32 colunas e apenas quebrava o layout de 80 mm, desperdiçando papel.
    if (
        known is COMPACT_58MM_PROFILE
        and explicit_key == "thermal-58mm"
        and explicit_width == 58
        and explicit_columns == 32
    ):
        return COMPACT_58MM_PROFILE

    base = known or DEFAULT_PROFILE
    if explicit_width and explicit_columns:
        return PrinterPaperProfile(
            key=explicit_key or f"thermal-{explicit_width}mm",
            paper_width_mm=explicit_width,
            columns=explicit_columns,
            font_mode=str(opts.get("font_mode") or base.font_mode).upper(),
            encoding=str(opts.get("encoding") or base.encoding),
            code_page=_positive_int(opts.get("code_page")) or base.code_page,
            line_spacing_dots=(
                _positive_int(opts.get("line_spacing_dots"))
                if opts.get("line_spacing_dots") is not None
                else base.line_spacing_dots
            ),
            feed_lines=_positive_int(opts.get("feed_lines")) or base.feed_lines,
            compact_layout=bool(
                opts.get("compact_layout", base.compact_layout)
            ),
            print_width_dots=(
                _positive_int(opts.get("print_width_dots"))
                or base.print_width_dots
            ),
        )

    return PrinterPaperProfile(
        key=explicit_key or base.key,
        paper_width_mm=explicit_width or base.paper_width_mm,
        columns=explicit_columns or base.columns,
        font_mode=str(opts.get("font_mode") or base.font_mode).upper(),
        encoding=str(opts.get("encoding") or base.encoding),
        code_page=_positive_int(opts.get("code_page")) or base.code_page,
        line_spacing_dots=(
            _positive_int(opts.get("line_spacing_dots"))
            if opts.get("line_spacing_dots") is not None
            else base.line_spacing_dots
        ),
        feed_lines=_positive_int(opts.get("feed_lines")) or base.feed_lines,
        compact_layout=bool(opts.get("compact_layout", base.compact_layout)),
        print_width_dots=(
            _positive_int(opts.get("print_width_dots"))
            or base.print_width_dots
        ),
    )


def enrich_endpoint_options(
    name: str,
    *,
    display_name: str = "",
    transport: str = "",
    options: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Completa/migra capabilities sem espalhar regras por modelo no agente."""
    result = dict(options or {})
    profile = infer_printer_paper_profile(
        name,
        display_name=display_name,
        transport=transport,
        options=result,
    )

    # O perfil 58 mm v1 era gerado automaticamente pelo próprio KÔMA.
    # Substituí-lo é uma migração, não uma sobrescrita de escolha do usuário.
    legacy_auto_58 = (
        _known_profile(name, display_name) is COMPACT_58MM_PROFILE
        and result.get("paper_profile") == "thermal-58mm"
        and _positive_int(result.get("paper_width_mm")) == 58
        and _positive_int(result.get("columns")) == 32
    )
    values = {
        "paper_profile": profile.key,
        "paper_width_mm": profile.paper_width_mm,
        "columns": profile.columns,
        "font_mode": profile.font_mode,
        "encoding": profile.encoding,
        "code_page": profile.code_page,
        "line_spacing_dots": profile.line_spacing_dots,
        "feed_lines": profile.feed_lines,
        "compact_layout": profile.compact_layout,
        "print_width_dots": profile.print_width_dots,
    }
    for key in _PROFILE_OPTION_NAMES:
        value = values[key]
        if legacy_auto_58:
            result[key] = value
        elif key not in result:
            result[key] = value
    return result
