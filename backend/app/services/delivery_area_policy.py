"""Política opt-in de área permitida para Delivery do cardápio público."""

from __future__ import annotations

import unicodedata
from typing import Any

from ..application.orders.commands import DeliveryAddressInput


OUTSIDE_DELIVERY_AREA_MESSAGE = (
    "Este endereço fica fora da área de entrega deste restaurante. "
    "Altere o endereço ou escolha Retirada."
)
INCOMPLETE_DELIVERY_ADDRESS_MESSAGE = (
    "Confirme o endereço completo para validar a área de entrega."
)


def _display_text(value: object) -> str:
    return " ".join(str(value or "").strip().split())


def _location_key(value: object) -> str:
    text = unicodedata.normalize("NFD", _display_text(value).casefold())
    return "".join(char for char in text if unicodedata.category(char) != "Mn")


def normalize_delivery_area_policy(raw: Any) -> dict[str, Any] | None:
    """Normaliza a política persistida.

    None mantém compatibilidade: restaurantes existentes continuam sem restrição
    até ativarem explicitamente a área de entrega.
    """
    if raw in (None, "", {}):
        return None
    if not isinstance(raw, dict):
        raise ValueError("A área de entrega configurada é inválida.")

    enabled = raw.get("enabled") is True
    if not enabled:
        return {"enabled": False}

    city = _display_text(raw.get("city"))
    state = _display_text(raw.get("state")).upper()
    if not city:
        raise ValueError("Informe a cidade atendida antes de restringir a área de entrega.")
    if len(state) != 2 or not state.isalpha():
        raise ValueError("Informe uma UF válida com 2 letras para restringir a área de entrega.")

    raw_neighborhoods = raw.get("neighborhoods") or []
    if not isinstance(raw_neighborhoods, (list, tuple)):
        raise ValueError("A lista de bairros atendidos é inválida.")

    neighborhoods: list[str] = []
    seen: set[str] = set()
    for raw_name in raw_neighborhoods:
        name = _display_text(raw_name)
        if not name:
            continue
        if len(name) > 120:
            raise ValueError("Um bairro da área de entrega excede o limite permitido.")
        key = _location_key(name)
        if key in seen:
            continue
        seen.add(key)
        neighborhoods.append(name)

    return {
        "enabled": True,
        "city": city,
        "state": state,
        "neighborhoods": neighborhoods,
    }


def delivery_area_unavailability(
    raw_policy: Any,
    address: DeliveryAddressInput | None,
) -> str | None:
    """Retorna motivo de bloqueio ou None quando Delivery pode prosseguir."""
    policy = normalize_delivery_area_policy(raw_policy)
    if not policy or not policy.get("enabled"):
        return None
    if address is None:
        return INCOMPLETE_DELIVERY_ADDRESS_MESSAGE

    if (
        _location_key(address.city) != _location_key(policy["city"])
        or address.state.upper() != policy["state"]
    ):
        return OUTSIDE_DELIVERY_AREA_MESSAGE

    allowed_neighborhoods = policy.get("neighborhoods") or []
    if allowed_neighborhoods:
        allowed = {_location_key(name) for name in allowed_neighborhoods}
        if _location_key(address.neighborhood) not in allowed:
            return OUTSIDE_DELIVERY_AREA_MESSAGE

    return None
