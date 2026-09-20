"""Operational readiness projection for first-access onboarding."""

from __future__ import annotations

from typing import Any

from ..models import ConfiguracaoRestaurante, Restaurante
from .operational_modes import explicit_order_types


def _has_items(value: object) -> bool:
    if value is None:
        return False
    if isinstance(value, (list, tuple, set, dict)):
        return bool(value)
    return bool(str(value).strip())


def delivery_configuration_ready(
    config: ConfiguracaoRestaurante | None,
    restaurant: Restaurante,
) -> bool:
    if config is None or config.delivery_ativo is not True:
        return False
    mode = str(config.tipo_taxa_entrega or "fixa").strip().lower()
    if mode == "fixa":
        try:
            return config.taxa_entrega_fixa is not None and float(config.taxa_entrega_fixa) >= 0
        except (TypeError, ValueError):
            return False
    if mode == "bairro":
        return _has_items(config.tabela_taxas_bairros)
    if mode == "distancia":
        return (
            _has_items(config.tabela_taxas_km)
            and restaurant.latitude is not None
            and restaurant.longitude is not None
        )
    return False


def evaluate_operation_readiness(
    *,
    config: ConfiguracaoRestaurante | None,
    restaurant: Restaurante,
    table_count: int,
    legacy_policy_allowed: bool,
) -> dict[str, Any]:
    explicit = explicit_order_types(config)
    legacy = explicit is None and legacy_policy_allowed
    order_types = list(explicit or [])
    configured = bool(order_types) or legacy

    dine_in_enabled = "consumo_local" in order_types
    delivery_enabled = "delivery" in order_types
    pickup_enabled = "retirada" in order_types
    table_map_enabled = bool(config and config.mapa_mesas_ativo)

    blockers: list[str] = []
    if not configured:
        blockers.append("order_types")
    if dine_in_enabled and table_map_enabled and table_count <= 0:
        blockers.append("dine_in_tables")
    if delivery_enabled and not delivery_configuration_ready(config, restaurant):
        blockers.append("delivery_configuration")

    service_charge_enabled = bool(config and config.taxa_servico_ativa)
    try:
        service_charge_percent = float(config.taxa_servico_padrao or 0) if config else 0.0
    except (TypeError, ValueError):
        service_charge_percent = 0.0
    if service_charge_enabled and not 0 < service_charge_percent <= 100:
        blockers.append("service_charge")

    return {
        "configured": configured,
        "ready": configured and not blockers,
        "legacyPolicy": legacy,
        "orderTypes": order_types,
        "tableMapEnabled": table_map_enabled,
        "serviceChargeEnabled": service_charge_enabled,
        "serviceChargePercent": service_charge_percent,
        "capabilities": {
            "dineIn": {
                "enabled": dine_in_enabled,
                "ready": not dine_in_enabled or not table_map_enabled or table_count > 0,
            },
            "pickup": {"enabled": pickup_enabled, "ready": True},
            "delivery": {
                "enabled": delivery_enabled,
                "ready": not delivery_enabled or delivery_configuration_ready(config, restaurant),
            },
        },
        "blockers": blockers,
    }
