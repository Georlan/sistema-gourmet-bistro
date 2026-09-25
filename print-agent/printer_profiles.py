"""Perfis físicos de papel para impressão térmica.

O backend gera uma comanda canônica; o agente adapta o texto ao equipamento
físico antes de produzir ESC/POS. Perfis conhecidos servem como sugestão
automática e opções persistidas no PrinterEndpoint sempre têm prioridade.
"""

from dataclasses import dataclass
import re
from typing import Any, Mapping


@dataclass(frozen=True)
class PrinterPaperProfile:
    key: str
    paper_width_mm: int
    columns: int


DEFAULT_PROFILE = PrinterPaperProfile(
    key="thermal-80mm",
    paper_width_mm=80,
    columns=48,
)

KNOWN_PROFILES: tuple[tuple[re.Pattern[str], PrinterPaperProfile], ...] = (
    (
        re.compile(r"(?:^|\b)(?:KA[-\s]?1445|KA7)(?:\b|$)", re.IGNORECASE),
        PrinterPaperProfile(
            key="thermal-58mm",
            paper_width_mm=58,
            columns=32,
        ),
    ),
    (
        re.compile(r"(?:^|\b)G[-\s]?250(?:\b|$)", re.IGNORECASE),
        PrinterPaperProfile(
            key="thermal-80mm",
            paper_width_mm=80,
            columns=48,
        ),
    ),
)


def _positive_int(value: Any) -> int | None:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def infer_printer_paper_profile(
    name: str,
    *,
    display_name: str = "",
    transport: str = "",
    options: Mapping[str, Any] | None = None,
) -> PrinterPaperProfile:
    """Resolve o perfil físico sem amarrar o transporte a um tamanho de papel."""
    opts = dict(options or {})
    explicit_width = _positive_int(opts.get("paper_width_mm"))
    explicit_columns = _positive_int(opts.get("columns"))
    explicit_key = str(opts.get("paper_profile") or "").strip()

    if explicit_width and explicit_columns:
        return PrinterPaperProfile(
            key=explicit_key or f"thermal-{explicit_width}mm",
            paper_width_mm=explicit_width,
            columns=explicit_columns,
        )

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
            return PrinterPaperProfile(
                key=explicit_key or profile.key,
                paper_width_mm=explicit_width or profile.paper_width_mm,
                columns=explicit_columns or profile.columns,
            )

    # Não inferimos tamanho por USB/Bluetooth/rede: qualquer transporte pode
    # carregar impressoras de 58 ou 80 mm. O fallback preserva o layout legado.
    return PrinterPaperProfile(
        key=explicit_key or DEFAULT_PROFILE.key,
        paper_width_mm=explicit_width or DEFAULT_PROFILE.paper_width_mm,
        columns=explicit_columns or DEFAULT_PROFILE.columns,
    )


def enrich_endpoint_options(
    name: str,
    *,
    display_name: str = "",
    transport: str = "",
    options: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Adiciona perfil ausente sem sobrescrever escolhas explícitas do usuário."""
    result = dict(options or {})
    profile = infer_printer_paper_profile(
        name,
        display_name=display_name,
        transport=transport,
        options=result,
    )
    result.setdefault("paper_profile", profile.key)
    result.setdefault("paper_width_mm", profile.paper_width_mm)
    result.setdefault("columns", profile.columns)
    return result
