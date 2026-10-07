"""Inteligência de ordenação canônica do Cardápio KÔMA.

Regras de ordenação:
1. Ordem persistida pelo restaurante (ordem_exibicao) SEMPRE vence qualquer default.
2. Para categorias sem ordem explícita:
   a. Semântica determinística por nicho operacional do restaurante (hamburgueria, pizzaria, marmitaria, geral);
   b. Compatibilidade regressiva com a lista canônica legada CATEGORY_DISPLAY_ORDER;
   c. Nome em ordem estável como último fallback extremo.
3. Categorias e produtos possuem ordenação determinística e independente de timestamps de criação.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Any, Iterable, Optional, Sequence, Union


def normalize_text(text: Optional[str]) -> str:
    """Normaliza texto para comparações semânticas determinísticas."""
    if not text:
        return ""
    normalized = unicodedata.normalize("NFKD", text)
    stripped = "".join(c for c in normalized if not unicodedata.combining(c))
    return stripped.lower().strip()


# Expressões regulares semânticas para bebidas e sobremesas compartilhadas
BEBIDA_REGEX = re.compile(
    r"\b(bebida|bebidas|drink|drinks|refrigerante|refrigerantes|suco|sucos|agua|aguas|cerveja|cervejas|chopp|vinho|vinhos|cha|chas|cafe|cafes|energetico|energeticos)\b",
    re.IGNORECASE,
)
SOBREMESA_REGEX = re.compile(
    r"\b(sobremesa|sobremesas|doce|doces|dessert|desserts|sorvete|sorvetes|milkshake|milk-shake|acai|torta|tortas|brownie|pudim|petit gateau)\b",
    re.IGNORECASE,
)

# Tiers determinísticos de ordenação por nicho (números de ordenação default com espaçamento)
NICHE_TIERS: dict[str, list[tuple[int, re.Pattern]]] = {
    "hamburgueria": [
        # 1. Hambúrgueres / Burgers
        (10, re.compile(r"\b(burger|burgers|hamburguer|hamburgueres|sanduiche|sanduiches|smash|lanche|lanches|artesanal)\b", re.IGNORECASE)),
        # 2. Combos
        (20, re.compile(r"\b(combo|combos|promocional|promocionais|oferta|ofertas)\b", re.IGNORECASE)),
        # 3. Porções / Petiscos / Entradas
        (30, re.compile(r"\b(porcao|porcoes|petisco|petiscos|fritas|batata|batatas|onion|anel|aneis|nuggets|entrada|entradas|acompanhamento|acompanhamentos)\b", re.IGNORECASE)),
        # 4. Bebidas
        (40, BEBIDA_REGEX),
        # 5. Sobremesas
        (50, SOBREMESA_REGEX),
    ],
    "pizzaria": [
        # 1. Pizzas
        (10, re.compile(r"\b(pizza|pizzas|calzone|calzones|esfiha|esfihas|focaccia|focaccias)\b", re.IGNORECASE)),
        # 2. Combos
        (20, re.compile(r"\b(combo|combos|promocional|promocionais)\b", re.IGNORECASE)),
        # 3. Entradas / Porções
        (30, re.compile(r"\b(entrada|entradas|petisco|petiscos|porcao|porcoes|borda|bordas|crostini|antepasto|antepastos)\b", re.IGNORECASE)),
        # 4. Bebidas
        (40, BEBIDA_REGEX),
        # 5. Sobremesas
        (50, SOBREMESA_REGEX),
    ],
    "marmitaria": [
        # 1. Quentinhas / Refeições
        (10, re.compile(r"\b(quentinha|quentinhas|marmita|marmitas|marmitex|refeicao|refeicoes|prato feito|pf|almoço|almoco|executivo|executivos|fit|fitness)\b", re.IGNORECASE)),
        # 2. Combos
        (20, re.compile(r"\b(combo|combos|promocional|promocionais)\b", re.IGNORECASE)),
        # 3. Acompanhamentos / Guarnições
        (30, re.compile(r"\b(acompanhamento|acompanhamentos|guarnicao|guarnicoes|porcao|porcoes|adicional|adicionais|salada|saladas)\b", re.IGNORECASE)),
        # 4. Bebidas
        (40, BEBIDA_REGEX),
        # 5. Sobremesas
        (50, SOBREMESA_REGEX),
    ],
    "geral": [
        # 1. Pratos / Principais
        (10, re.compile(r"\b(prato|pratos|principal|principais|carne|carnes|peixe|peixes|frango|frangos|massa|massas|risoto|risotos|alacarte|a la carte|refeicao|refeicoes)\b", re.IGNORECASE)),
        # 2. Combos / Executivos
        (20, re.compile(r"\b(combo|combos|executivo|executivos|promocional|promocionais)\b", re.IGNORECASE)),
        # 3. Entradas / Porções
        (30, re.compile(r"\b(entrada|entradas|porcao|porcoes|petisco|petiscos|salada|saladas|aperitivo|aperitivos)\b", re.IGNORECASE)),
        # 4. Bebidas
        (40, BEBIDA_REGEX),
        # 5. Sobremesas
        (50, SOBREMESA_REGEX),
    ],
}

NICHE_ALIASES: dict[str, str] = {
    "hamburgueria": "hamburgueria",
    "burger": "hamburgueria",
    "burgers": "hamburgueria",
    "hamburguer": "hamburgueria",
    "sanduiches": "hamburgueria",
    "pizzaria": "pizzaria",
    "pizza": "pizzaria",
    "pizzas": "pizzaria",
    "marmitaria": "marmitaria",
    "quentinha": "marmitaria",
    "marmita": "marmitaria",
    "alacarte": "geral",
    "selfservice": "geral",
    "doceria": "geral",
    "cafeteria": "geral",
    "bar": "geral",
    "churrasco": "geral",
    "acai": "geral",
    "generic": "geral",
}

LEGACY_CATEGORY_DISPLAY_ORDER = [
    "Quentinhas",
    "Pizzas Tradicionais", "Pizzas Especiais", "Hambúrgueres Bovinos",
    "Hambúrgueres de Frango", "Hambúrgueres Suínos", "Baguetes",
    "Pastéis Tradicionais", "Pastelões Especiais", "Pastéis Doces",
    "Petiscos", "Combos Promocionais", "Sucos", "Refrigerantes e Águas",
    "Bebidas & Vinhos", "Cervejas", "Bebidas Quentes", "Sobremesas",
]
_LEGACY_POSITIONS = {
    normalize_text(name): index
    for index, name in enumerate(LEGACY_CATEGORY_DISPLAY_ORDER)
}


def resolve_category_sort_key(
    category_name: str,
    explicit_order: Optional[int] = None,
    niche: Optional[str] = None,
    category_id: Optional[str] = None,
) -> tuple[int, int, str, str]:
    """Calcula a chave de ordenação determinística de uma categoria.

    Prioridade 0: ordem_exibicao explícita persistida.
    Prioridade 1: correspondência semântica de nicho específico (quando informado).
    Prioridade 2: compatibilidade regressiva com a lista legada canônica (CATEGORY_DISPLAY_ORDER).
    Prioridade 3: nicho geral (quando nicho for geral/padrão).
    Prioridade 4: ordenação alfabética estável (fallback extremo).
    """
    norm_name = normalize_text(category_name)
    str_id = str(category_id or "")

    # 1. Ordem explícita SEMPRE vence
    if explicit_order is not None:
        return (0, int(explicit_order), norm_name, str_id)

    # 2. Nicho operacional específico (hamburgueria, pizzaria, marmitaria)
    niche_key = normalize_text(niche or "")
    if niche_key and niche_key not in ("geral", "generic", "restaurante_geral"):
        canonical_niche = NICHE_ALIASES.get(niche_key)
        if canonical_niche and canonical_niche in ("hamburgueria", "pizzaria", "marmitaria"):
            tiers = NICHE_TIERS[canonical_niche]
            for tier_rank, pattern in tiers:
                if pattern.search(norm_name):
                    return (1, tier_rank, norm_name, str_id)

    # 3. Lista canônica legada (compatibilidade com tenants não migrados)
    if category_name in _LEGACY_POSITIONS:
        return (2, _LEGACY_POSITIONS[category_name], norm_name, str_id)
    if norm_name in _LEGACY_POSITIONS:
        return (2, _LEGACY_POSITIONS[norm_name], norm_name, str_id)

    # 4. Nicho geral / genérico
    general_tiers = NICHE_TIERS["geral"]
    for tier_rank, pattern in general_tiers:
        if pattern.search(norm_name):
            return (3, tier_rank, norm_name, str_id)

    # 5. Fallback alfabético extremo
    return (4, 9999, norm_name, str_id)


def ordered_categories(
    categories: Sequence[Any],
    niche: Optional[str] = None,
) -> list[Any]:
    """Retorna categorias ordenadas deterministicamente."""
    return sorted(
        categories,
        key=lambda category: resolve_category_sort_key(
            category_name=getattr(category, "nome", "") or "",
            explicit_order=getattr(category, "ordem_exibicao", None),
            niche=niche,
            category_id=getattr(category, "id", None),
        ),
    )


def resolve_product_sort_key(
    product_name: str,
    explicit_order: Optional[int] = None,
    product_id: Optional[str] = None,
) -> tuple[int, int, str, str]:
    """Calcula a chave de ordenação determinística de um produto.

    Prioridade 0: ordem_exibicao explícita do produto.
    Prioridade 1: nome alfabético estável e id (fallback).
    """
    norm_name = normalize_text(product_name)
    str_id = str(product_id or "")
    if explicit_order is not None:
        return (0, int(explicit_order), norm_name, str_id)
    return (1, 0, norm_name, str_id)


def ordered_products(products: Sequence[Any]) -> list[Any]:
    """Retorna produtos ordenados deterministicamente por ordem_exibicao."""
    return sorted(
        products,
        key=lambda product: resolve_product_sort_key(
            product_name=getattr(product, "nome", "") or "",
            explicit_order=getattr(product, "ordem_exibicao", None),
            product_id=getattr(product, "id", None),
        ),
    )


def resolve_restaurant_niche(db: Any, restaurante_id: int) -> str:
    """Detecta o nicho operacional do restaurante de forma segura e resiliente."""
    try:
        from .restaurant_profile_models import RestauranteOperationProfile
        profile = (
            db.query(RestauranteOperationProfile.profile_key)
            .filter(RestauranteOperationProfile.restaurante_id == restaurante_id)
            .first()
        )
        if profile and profile[0] and profile[0].strip() and profile[0].strip().lower() != "generic":
            return profile[0].strip().lower()
    except Exception:
        pass

    try:
        from .models import ConfiguracaoRestaurante
        cfg = (
            db.query(ConfiguracaoRestaurante.nicho)
            .filter(ConfiguracaoRestaurante.restaurante_id == restaurante_id)
            .first()
        )
        if cfg and cfg[0] and cfg[0].strip():
            return cfg[0].strip().lower()
    except Exception:
        pass

    return "geral"
