from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Mapping, Optional

from sqlalchemy.orm import Session

from ...config import settings
from ...models import PrintAgentToken

_COMPACT_58_PRINTER_RE = re.compile(
    r"(?:^|\b|_)(?:"
    r"KA[-\s_]?1445|KA7|KAPBOM|KPRINTER|"
    r"MTP[-\s_]?(?:II|2)|MPT[-\s_]?(?:II|2)|"
    r"POS[-\s_]?58|ZJ[-\s_]?58|XP[-\s_]?58|"
    r"RPP02|PT[-\s_]?210|MOBILE\s+PRINTER|58\s*MM"
    r")(?:\b|_|$)",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class PrinterPaperProfile:
    """Perfil físico resolvido no backend para dimensionar a comanda."""

    width: int
    compact_58: bool = False


def _positive_int(value: Any) -> Optional[int]:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _is_compact_58_name(name: object, display_name: object = "") -> bool:
    identity = f"{str(name or '').strip()} {str(display_name or '').strip()}".strip()
    return bool(identity and _COMPACT_58_PRINTER_RE.search(identity))


def _endpoint_matches_58mm(endpoint: Mapping[str, Any]) -> bool:
    options = endpoint.get("options")
    if isinstance(options, Mapping):
        semantic_layout = str(options.get("semantic_layout") or "").strip().casefold()
        if semantic_layout == "compact_58":
            return True
        paper_width_mm = _positive_int(options.get("paper_width_mm"))
        if paper_width_mm is not None and paper_width_mm <= 60:
            return True
        columns = _positive_int(options.get("columns"))
        if columns is not None and columns <= 36:
            return True

    return _is_compact_58_name(
        endpoint.get("name"),
        endpoint.get("display_name"),
    )


def _select_endpoint(
    diagnostics: Mapping[str, Any],
    destination: Optional[str],
) -> Optional[Mapping[str, Any]]:
    endpoints = diagnostics.get("endpoints")
    if not isinstance(endpoints, list) or not endpoints:
        return None

    by_id = {
        str(ep.get("id")): ep
        for ep in endpoints
        if isinstance(ep, Mapping) and ep.get("id")
    }
    destinations = diagnostics.get("destinations")
    if isinstance(destinations, Mapping):
        dest_key = str(destination or "").strip().upper()
        for candidate_key in (dest_key, "PADRAO", "CAIXA", "COZINHA"):
            if not candidate_key:
                continue
            endpoint_id = destinations.get(candidate_key)
            if endpoint_id and str(endpoint_id) in by_id:
                return by_id[str(endpoint_id)]

    default_printer = str(diagnostics.get("default_printer") or "").strip().casefold()
    if default_printer:
        for ep in endpoints:
            if not isinstance(ep, Mapping):
                continue
            ep_name = str(ep.get("name") or "").strip().casefold()
            ep_display = str(ep.get("display_name") or "").strip().casefold()
            if default_printer in {ep_name, ep_display}:
                return ep

    first = endpoints[0]
    return first if isinstance(first, Mapping) else None


def resolve_printer_paper_profile(
    db: Optional[Session],
    restaurante_id: Optional[int],
    *,
    destination: Optional[str] = None,
) -> PrinterPaperProfile:
    """Resolve largura e modo compacto a partir do agente ativo do restaurante."""
    default_width = int(getattr(settings, "PRINTER_WIDTH", 48) or 48)
    default_profile = PrinterPaperProfile(width=default_width, compact_58=False)

    if db is None or not restaurante_id or not hasattr(db, "query"):
        return default_profile

    try:
        agents = (
            db.query(PrintAgentToken)
            .filter(
                PrintAgentToken.restaurante_id == int(restaurante_id),
                PrintAgentToken.ativo.is_(True),
                PrintAgentToken.printer_diagnostics.isnot(None),
            )
            .order_by(
                PrintAgentToken.is_primary.desc(),
                PrintAgentToken.last_seen_at.desc().nullslast(),
                PrintAgentToken.created_at.desc(),
            )
            .all()
        )
    except Exception:
        return default_profile

    if not isinstance(agents, (list, tuple)):
        return default_profile

    for agent in agents:
        diagnostics = getattr(agent, "printer_diagnostics", None)
        if not isinstance(diagnostics, Mapping):
            continue
        endpoint = _select_endpoint(diagnostics, destination)
        if endpoint is not None:
            if _endpoint_matches_58mm(endpoint):
                return PrinterPaperProfile(width=32, compact_58=True)
            return default_profile
        if _is_compact_58_name(diagnostics.get("default_printer")):
            return PrinterPaperProfile(width=32, compact_58=True)
        printers = diagnostics.get("printers")
        if isinstance(printers, list) and printers:
            for printer in printers:
                if isinstance(printer, Mapping) and printer.get("is_default"):
                    if _is_compact_58_name(printer.get("name")):
                        return PrinterPaperProfile(width=32, compact_58=True)
                    return default_profile
            return default_profile

    return default_profile
