from typing import Dict, List

from .models import PrintItem


def is_production_destination(destination: str) -> bool:
    """Retorna True somente para destinos que geram uma via setorial."""
    if not destination:
        return False
    dest_clean = str(destination).strip().upper()
    return dest_clean not in {"NENHUM", "NONE", ""}


def group_items_by_print_destination(items: List[PrintItem]) -> Dict[str, List[PrintItem]]:
    """Agrupa itens por destino de produção, ignorando itens sem via setorial."""
    grouped: Dict[str, List[PrintItem]] = {}

    for item in items:
        dest = (item.destino_impressao or "NENHUM").strip().upper()
        if not is_production_destination(dest):
            continue
        grouped.setdefault(dest, []).append(item)

    return grouped
