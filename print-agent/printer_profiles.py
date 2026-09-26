"""Perfis físicos de papel para impressão térmica.

O backend gera uma comanda canônica. O agente aplica um perfil físico somente
na borda de saída (largura, fonte, espaçamento e tabela de caracteres), sem
acoplar o layout de negócio a um modelo ou transporte específico.
"""

from dataclasses import dataclass
import re
from typing import Any, Mapping


PROFILE_VERSION = 2


@dataclass(frozen=True)
class PrinterPaperProfile:
    key: str
    paper_width_mm: int
    columns: int
    font_mode: str = "a"
    line_spacing_dots: int | None = None
    feed_lines: int = 3
    encoding: str = "cp860"
    code_page: int = 3
    compact_whitespace: bool = False


WIDE_80_PROFILE = PrinterPaperProfile(
    key="thermal-80mm",
    paper_width_mm=80,
    columns=48,
    font_mode="a",
    line_spacing_dots=None,
    feed_lines=3,
    encoding="cp860",
    code_page=3,
    compact_whitespace=False,
)

COMPACT_58_PROFILE = PrinterPaperProfile(
    key="thermal-58mm",
    paper_width_mm=58,
    # Em cabeças térmicas de 384 dots, Font B (9 dots) comporta 42 colunas.
    # Isso reduz quebras e altura sem sacrificar legibilidade.
    columns=42,
    font_mode="b",
    line_spacing_dots=24,
    feed_lines=2,
    encoding="cp860",
    code_page=3,
    compact_whitespace=True,
)

# Compatibilidade nominal.
DEFAULT_PROFILE = WIDE_80_PROFILE

KNOWN_PROFILES: tuple[tuple[re.Pattern[str], PrinterPaperProfile], ...] = (
    (
        re.compile(r"(?:^|\b)(?:KA[-\s]?1445|KA7)(?:\b|$)", re.IGNORECASE),
        # A KA-1445 é 58 mm e, na unidade homologada, a tabela CP850 é mais
        # confiável para acentos latinos do que a seleção CP860.
        PrinterPaperProfile(
            **{
                **COMPACT_58_PROFILE.__dict__,
                "encoding": "cp850",
                "code_page": 2,
            }
        ),
    ),
    (
        re.compile(r"(?:^|\b)G[-\s]?250(?:\b|$)", re.IGNORECASE),
        WIDE_80_PROFILE,
    ),
)


def _positive_int(value: Any) -> int | None:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _base_profile_for_width(width_mm: int | None) -> PrinterPaperProfile:
    if width_mm is not None and width_mm <= 60:
        return COMPACT_58_PROFILE
    return WIDE_80_PROFILE


def infer_printer_paper_profile(
    name: str,
    *,
    display_name: str = "",
    transport: str = "",
    options: Mapping[str, Any] | None = None,
) -> PrinterPaperProfile:
    """Resolve o perfil físico sem amarrar USB/Bluetooth/rede ao papel."""
    opts = dict(options or {})
    explicit_width = _positive_int(opts.get("paper_width_mm"))
    explicit_columns = _positive_int(opts.get("columns"))
    explicit_key = str(opts.get("paper_profile") or "").strip()

    identity = " ".join(
        part
        for part in (
            str(name or "").strip(),
            str(display_name or "").strip(),
        )
        if part
    )

    known_profile: PrinterPaperProfile | None = None
    for pattern, profile in KNOWN_PROFILES:
        if pattern.search(identity):
            known_profile = profile
            break

    base = known_profile or _base_profile_for_width(explicit_width)
    resolved_width = explicit_width or base.paper_width_mm

    # Perfis antigos de 58 mm eram gerados automaticamente em 32 colunas com
    # Font A. Migram para o perfil compacto v2; customizações novas continuam
    # podendo sobrescrever columns explicitamente.
    legacy_auto_58 = bool(
        int(opts.get("profile_version") or 0) < PROFILE_VERSION
        and explicit_key == "thermal-58mm"
        and resolved_width <= 60
        and explicit_columns == 32
    )
    resolved_columns = (
        base.columns
        if legacy_auto_58
        else (explicit_columns or base.columns)
    )

    def pick_str(key: str, fallback: str) -> str:
        value = str(opts.get(key) or "").strip().lower()
        return value or fallback

    return PrinterPaperProfile(
        key=explicit_key or base.key,
        paper_width_mm=resolved_width,
        columns=resolved_columns,
        font_mode=pick_str("font_mode", base.font_mode),
        line_spacing_dots=(
            _positive_int(opts.get("line_spacing_dots"))
            if opts.get("line_spacing_dots") is not None
            else base.line_spacing_dots
        ),
        feed_lines=_positive_int(opts.get("feed_lines")) or base.feed_lines,
        encoding=pick_str("encoding", base.encoding),
        code_page=_positive_int(opts.get("code_page")) or base.code_page,
        compact_whitespace=bool(
            opts.get("compact_whitespace")
            if "compact_whitespace" in opts
            else base.compact_whitespace
        ),
    )


def enrich_endpoint_options(
    name: str,
    *,
    display_name: str = "",
    transport: str = "",
    options: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Completa capacidades físicas e migra somente defaults legados seguros."""
    result = dict(options or {})
    profile = infer_printer_paper_profile(
        name,
        display_name=display_name,
        transport=transport,
        options=result,
    )

    legacy_auto_58 = bool(
        int(result.get("profile_version") or 0) < PROFILE_VERSION
        and str(result.get("paper_profile") or "") == "thermal-58mm"
        and _positive_int(result.get("paper_width_mm")) == 58
        and _positive_int(result.get("columns")) == 32
    )
    if legacy_auto_58:
        result["columns"] = profile.columns

    result.setdefault("paper_profile", profile.key)
    result.setdefault("paper_width_mm", profile.paper_width_mm)
    result.setdefault("columns", profile.columns)
    result.setdefault("font_mode", profile.font_mode)
    result.setdefault("line_spacing_dots", profile.line_spacing_dots)
    result.setdefault("feed_lines", profile.feed_lines)
    result.setdefault("encoding", profile.encoding)
    result.setdefault("code_page", profile.code_page)
    result.setdefault("compact_whitespace", profile.compact_whitespace)
    result["profile_version"] = PROFILE_VERSION
    return result
