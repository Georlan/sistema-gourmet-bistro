"""Shared profile fields; route authorization, transactions and events stay explicit."""

from fastapi import HTTPException, status

from ..models import Restaurante
from ..schemas import RestauranteConfigUpdate
from .storage_paths import validate_tenant_storage_reference

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
    rest_id = int(restaurante.id) if getattr(restaurante, "id", None) else 0
    for field in RESTAURANT_PROFILE_FIELDS:
        value = getattr(update, field)
        if value is not None:
            if rest_id > 0 and field in ("logo_url", "banner_url"):
                asset_kind = "logo" if field == "logo_url" else "banner"
                try:
                    value = validate_tenant_storage_reference(value, rest_id, asset_kind)
                except ValueError as exc:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=str(exc),
                    ) from exc
            setattr(restaurante, field, value)

