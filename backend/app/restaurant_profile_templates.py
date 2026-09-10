from __future__ import annotations

from copy import deepcopy
from typing import Any


_TEMPLATE_DRAFTS: dict[str, dict[str, Any]] = {
    "pizzaria": {
        "profile_key": "pizzaria",
        "categories": ["Pizzas", "Bebidas"],
        "modifier_groups": ["Borda", "Adicionais da pizza"],
    },
    "acai": {
        "profile_key": "acai",
        "categories": ["Açaí", "Bebidas"],
        "modifier_groups": ["Tamanho", "Complementos"],
    },
    "churrasco": {
        "profile_key": "churrasco",
        "categories": ["Carnes", "Acompanhamentos", "Bebidas"],
        "modifier_groups": ["Ponto da carne", "Acompanhamentos"],
    },
}


def list_template_keys() -> tuple[str, ...]:
    """Retorna apenas templates disponíveis para escolha explícita do operador."""
    return tuple(_TEMPLATE_DRAFTS)


def build_template_preview(profile_key: str) -> dict[str, Any] | None:
    """Monta um preview puro; nunca persiste catálogo, adicionais ou preços.

    O retorno é deliberadamente um rascunho sem valores monetários e sem IDs de
    banco. A aplicação futura do template deverá ocorrer por fluxo separado,
    explícito, idempotente e confirmado pelo operador.
    """
    template = _TEMPLATE_DRAFTS.get(profile_key.strip().lower())
    if template is None:
        return None

    preview = deepcopy(template)
    preview["mode"] = "preview"
    preview["requires_confirmation"] = True
    return preview
