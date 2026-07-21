import re
from typing import List, Dict
from dataclasses import replace
from .models import PrintItem

def normalize_observation(obs: str) -> str:
    """
    Normaliza a observação removendo espaços extras e quebras de linha duplicadas.
    """
    if not obs:
        return ""
    # Substitui quebras de linha e múltiplos espaços por um espaço único normalizado
    cleaned = re.sub(r"\s+", " ", str(obs).strip())
    return cleaned

def group_items_by_customer(items: List[PrintItem]) -> Dict[str, List[PrintItem]]:
    """
    Agrupa os itens por cliente identificado (preservando a ordem de aparição dos clientes).
    Clientes sem nome ou com nomes genéricos são agrupados sob 'GERAL'.
    """
    grouped: Dict[str, List[PrintItem]] = {}
    for item in items:
        raw_client = (item.cliente_nome or "").strip()
        client_name = raw_client.upper() if raw_client else "GERAL"
        
        # Trata variações comuns de cliente genérico
        if client_name in ("CONSUMO GERAL", "GERAL", "NENHUM", "MESA"):
            client_name = "GERAL"

        if client_name not in grouped:
            grouped[client_name] = []
        grouped[client_name].append(item)

    return grouped

def group_equivalent_items(items: List[PrintItem], match_observations: bool = True) -> List[PrintItem]:
    """
    Soma quantidades de itens equivalentes.
    
    Para PRODUÇÃO (match_observations=True):
    Só agrupa se: mesmo cliente, mesmo produto (código/nome), mesma observação normalizada e mesmo destino.
    
    Para FECHAMENTO (match_observations=False):
    Agrupa se: mesmo cliente, mesmo produto, mesmo preço unitário. (Observações são ignoradas no fechamento).
    """
    grouped: List[PrintItem] = []

    for item in items:
        code = (item.codigo or "").strip().upper()
        name = (item.nome or "").strip().upper()
        client = (item.cliente_nome or "").strip().upper()
        obs_norm = normalize_observation(item.observacao) if match_observations else ""
        dest = (item.destino_impressao or "").strip().upper()

        matched = False
        for g in grouped:
            g_code = (g.codigo or "").strip().upper()
            g_name = (g.nome or "").strip().upper()
            g_client = (g.cliente_nome or "").strip().upper()
            g_obs = normalize_observation(g.observacao) if match_observations else ""
            g_dest = (g.destino_impressao or "").strip().upper()

            same_product = (g_code == code and g_name == name) or (g_code == code if code else g_name == name)
            same_client = g_client == client
            same_dest = g_dest == dest
            same_obs = (g_obs == obs_norm) if match_observations else True
            same_price = abs(g.preco_unit - item.preco_unit) < 0.001

            if same_product and same_client and same_dest and same_obs and same_price:
                g.quantidade += item.quantidade
                matched = True
                break

        if not matched:
            # Cria uma cópia do item com a quantidade atual
            grouped.append(replace(item, quantidade=item.quantidade))

    return grouped
