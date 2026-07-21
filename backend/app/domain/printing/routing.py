from typing import List, Dict
from .models import PrintItem
from .types import PrintDestination

def is_production_destination(destination: str) -> bool:
    """
    Retorna True se o destino de impressão for um setor de produção válido.
    Destinos 'NENHUM', vazios ou None não geram impressão de produção.
    """
    if not destination:
        return False
    dest_clean = str(destination).strip().upper()
    return dest_clean != PrintDestination.NENHUM.value and dest_clean != "NONE"

def group_items_by_print_destination(items: List[PrintItem]) -> Dict[str, List[PrintItem]]:
    """
    Agrupa os itens recebidos pelo seu destino de impressão de categoria.
    Destinos 'NENHUM' ou inválidos são filtrados e não aparecem no dicionário retornado.
    
    Exemplo de retorno:
    {
        "COZINHA": [PrintItem(...), PrintItem(...)],
        "BAR": [PrintItem(...)]
    }
    """
    grouped: Dict[str, List[PrintItem]] = {}

    for item in items:
        dest = (item.destino_impressao or "NENHUM").strip().upper()
        if not is_production_destination(dest):
            continue

        if dest not in grouped:
            grouped[dest] = []
        grouped[dest].append(item)

    return grouped
