"""Shared profile fields; route authorization, transactions and events stay explicit."""

from ..models import Restaurante
from ..schemas import RestauranteConfigUpdate

RESTAURANT_PROFILE_FIELDS = (
    "nome", "slug", "logo_url", "banner_url", "subtitulo", "sobre_nos",
    "endereco", "google_maps_url", "latitude", "longitude", "status_override",
    "socials", "horarios_funcionamento", "formas_pagamento_aceitas",
    "cor_primaria", "cor_fundo",
)


def apply_restaurant_profile_update(
    restaurante: Restaurante, update: RestauranteConfigUpdate,
) -> None:
    # Preserve the legacy PATCH semantics: missing/null is ignored; empty values apply.
    # Do not iterate arbitrary client keys or all schema fields.
    for field in RESTAURANT_PROFILE_FIELDS:
        value = getattr(update, field)
        if value is not None:
            setattr(restaurante, field, value)
