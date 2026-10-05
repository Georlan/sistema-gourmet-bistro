"""Regras explícitas de área de entrega do Cardápio Online.

A regra é opt-in por tenant e afeta somente delivery público. Retirada e consumo
local continuam disponíveis independentemente da localização do cliente.
"""

from __future__ import annotations

import unicodedata
from collections.abc import Sequence


def _normalized(value: object) -> str:
    text = " ".join(str(value or "").strip().split()).casefold()
    decomposed = unicodedata.normalize("NFD", text)
    return "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")


def normalize_allowed_cities(raw: object) -> tuple[dict[str, str], ...]:
    if not isinstance(raw, (list, tuple)):
        return ()
    result: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for item in raw:
        if not isinstance(item, dict):
            continue
        city = " ".join(str(item.get("cidade") or "").strip().split())
        state = str(item.get("uf") or "").strip().upper()
        if not city or len(state) != 2 or not state.isalpha():
            continue
        key = (_normalized(city), state)
        if key in seen:
            continue
        seen.add(key)
        result.append({"cidade": city, "uf": state})
    return tuple(result)


def normalize_allowed_neighborhoods(raw: object) -> tuple[str, ...]:
    if not isinstance(raw, (list, tuple)):
        return ()
    result: list[str] = []
    seen: set[str] = set()
    for item in raw:
        value = " ".join(str(item or "").strip().split())
        key = _normalized(value)
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(value)
    return tuple(result)


def validate_public_delivery_area(
    *,
    enabled: bool,
    allowed_cities: object,
    allowed_neighborhoods: object,
    city: str,
    state: str,
    neighborhood: str,
) -> str | None:
    """Retorna mensagem amigável quando um endereço não pode receber delivery."""
    if not enabled:
        return None

    cities = normalize_allowed_cities(allowed_cities)
    neighborhoods = normalize_allowed_neighborhoods(allowed_neighborhoods)

    normalized_city = _normalized(city)
    normalized_state = str(state or "").strip().upper()
    normalized_neighborhood = _normalized(neighborhood)

    if not normalized_city or len(normalized_state) != 2:
        return "Não foi possível confirmar a cidade e a UF deste endereço. Revise o CEP/endereço para pedir entrega."

    if cities:
        allowed_city_keys = {(_normalized(item["cidade"]), item["uf"]) for item in cities}
        if (normalized_city, normalized_state) not in allowed_city_keys:
            return "Este endereço fica fora da área de entrega deste restaurante. Você pode alterar o endereço ou escolher Retirada."

    if neighborhoods:
        allowed_neighborhood_keys = {_normalized(item) for item in neighborhoods}
        if not normalized_neighborhood or normalized_neighborhood not in allowed_neighborhood_keys:
            return "Este bairro fica fora da área de entrega deste restaurante. Você pode alterar o endereço ou escolher Retirada."

    # Fail closed: ativar a proteção sem configurar nenhuma área não pode abrir
    # delivery para o país inteiro por acidente.
    if not cities and not neighborhoods:
        return "A área de entrega deste restaurante ainda não foi configurada. Escolha Retirada ou fale com o estabelecimento."

    return None
