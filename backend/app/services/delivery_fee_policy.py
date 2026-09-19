"""Validação e cálculo canônicos das políticas de taxa de entrega."""

from __future__ import annotations

from decimal import Decimal, InvalidOperation, ROUND_CEILING, ROUND_HALF_UP
from math import asin, cos, radians, sin, sqrt
from typing import Sequence


MAX_DELIVERY_FEE = Decimal("10000.00")
MAX_DELIVERY_DISTANCE_KM = Decimal("500.00")
_MONEY = Decimal("0.01")
_DISTANCE = Decimal("0.01")


def normalize_neighborhood(value: object) -> str:
    return " ".join(str(value or "").strip().split()).casefold()


def validate_delivery_fee(value: object) -> Decimal:
    try:
        fee = Decimal(str(value)).quantize(_MONEY, rounding=ROUND_HALF_UP)
    except (InvalidOperation, TypeError, ValueError):
        raise ValueError("A taxa de entrega configurada é inválida.") from None
    if not fee.is_finite() or fee < 0 or fee > MAX_DELIVERY_FEE:
        raise ValueError("A taxa de entrega configurada é inválida.")
    return fee


def normalize_neighborhood_fee_table(raw: Sequence[object] | object) -> tuple[dict, ...]:
    if not isinstance(raw, (list, tuple)):
        raise ValueError("A tabela de taxas por bairro é inválida.")

    normalized: list[dict] = []
    seen: set[str] = set()
    for item in raw:
        if not isinstance(item, dict):
            raise ValueError("A tabela de taxas por bairro é inválida.")
        display_name = " ".join(str(item.get("bairro") or "").strip().split())
        key = normalize_neighborhood(display_name)
        if not key or len(display_name) > 120:
            raise ValueError("A tabela de taxas por bairro é inválida.")
        if key in seen:
            raise ValueError(f"O bairro '{display_name}' está duplicado na tabela de entrega.")
        seen.add(key)
        normalized.append({"bairro": display_name, "taxa": float(validate_delivery_fee(item.get("taxa")))})
    if not normalized:
        raise ValueError("Cadastre pelo menos um bairro para usar a cobrança por bairro.")
    return tuple(normalized)


def _distance_decimal(value: object, *, field: str, allow_zero: bool = False) -> Decimal:
    try:
        parsed = Decimal(str(value)).quantize(_DISTANCE, rounding=ROUND_HALF_UP)
    except (InvalidOperation, TypeError, ValueError):
        raise ValueError(f"{field} da cobrança por distância é inválido.") from None
    minimum = Decimal("0.00") if allow_zero else Decimal("0.01")
    if not parsed.is_finite() or parsed < minimum or parsed > MAX_DELIVERY_DISTANCE_KM:
        raise ValueError(f"{field} da cobrança por distância é inválido.")
    return parsed


def normalize_distance_fee_config(raw: Sequence[object] | object) -> dict:
    """Normaliza a configuração amigável persistida em tabela_taxas_km.

    O campo legado continua sendo uma lista para não exigir migração de banco,
    mas o modo por distância usa exatamente um objeto de política.
    """
    if isinstance(raw, dict):
        item = raw
    elif isinstance(raw, (list, tuple)) and len(raw) == 1 and isinstance(raw[0], dict):
        item = raw[0]
    else:
        raise ValueError("Configure a cobrança automática por distância antes de publicar.")

    minimum_fee = validate_delivery_fee(item.get("taxa_minima"))

    # Contrato simplificado atual: taxa mínima + valor por km.
    if "valor_por_km" in item:
        per_km_fee = validate_delivery_fee(item.get("valor_por_km"))
        return {
            "taxa_minima": float(minimum_fee),
            "valor_por_km": float(per_km_fee),
            "fallback_sem_localizacao": "minima",
        }

    # Compatibilidade com configurações gravadas antes da simplificação.
    included_km = _distance_decimal(item.get("km_inclusos"), field="A distância coberta pela taxa mínima")
    increment_fee = validate_delivery_fee(item.get("incremento_valor"))
    increment_km = _distance_decimal(item.get("incremento_km"), field="O intervalo de aumento")

    raw_max_fee = item.get("taxa_maxima")
    max_fee = None
    if raw_max_fee not in (None, "", 0, 0.0, "0", "0.0", "0.00"):
        max_fee = validate_delivery_fee(raw_max_fee)
        if max_fee < minimum_fee:
            raise ValueError("A taxa máxima não pode ser menor que a taxa mínima.")

    raw_max_distance = item.get("distancia_maxima_km")
    max_distance = None
    if raw_max_distance not in (None, "", 0, 0.0, "0", "0.0", "0.00"):
        max_distance = _distance_decimal(raw_max_distance, field="A distância máxima")

    return {
        "taxa_minima": float(minimum_fee),
        "km_inclusos": float(included_km),
        "incremento_valor": float(increment_fee),
        "incremento_km": float(increment_km),
        "taxa_maxima": float(max_fee) if max_fee is not None else None,
        "distancia_maxima_km": float(max_distance) if max_distance is not None else None,
        "fallback_sem_localizacao": "minima",
    }


def haversine_distance_km(
    origin_latitude: float,
    origin_longitude: float,
    destination_latitude: float,
    destination_longitude: float,
) -> float:
    """Distância geodésica entre dois pontos, sem depender de API de terceiros."""
    lat1, lon1, lat2, lon2 = map(
        radians,
        (origin_latitude, origin_longitude, destination_latitude, destination_longitude),
    )
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    distance = 2 * 6371.0088 * asin(sqrt(max(0.0, min(1.0, a))))
    return round(distance, 3)


def resolve_distance_delivery_fee(
    raw_config: Sequence[object] | object,
    *,
    origin_latitude: float | None,
    origin_longitude: float | None,
    destination_latitude: float | None,
    destination_longitude: float | None,
) -> tuple[Decimal, float | None]:
    """Resolve taxa por distância; sem coordenadas confiáveis usa a taxa mínima."""
    config = normalize_distance_fee_config(raw_config)
    minimum_fee = validate_delivery_fee(config["taxa_minima"])

    coordinates = (
        origin_latitude,
        origin_longitude,
        destination_latitude,
        destination_longitude,
    )
    if any(value is None for value in coordinates):
        return minimum_fee, None

    distance_km = haversine_distance_km(
        float(origin_latitude),
        float(origin_longitude),
        float(destination_latitude),
        float(destination_longitude),
    )

    if "valor_por_km" in config:
        per_km_fee = validate_delivery_fee(config["valor_por_km"])
        calculated_fee = Decimal(str(distance_km)) * per_km_fee
        fee = max(minimum_fee, calculated_fee)
        return fee.quantize(_MONEY, rounding=ROUND_HALF_UP), distance_km

    max_distance = config.get("distancia_maxima_km")
    if max_distance is not None and distance_km > float(max_distance):
        raise ValueError(
            f"Este endereço está a aproximadamente {distance_km:.1f} km e fica fora "
            f"do limite de entrega de {float(max_distance):.1f} km."
        )

    included_km = Decimal(str(config["km_inclusos"]))
    fee = minimum_fee
    distance = Decimal(str(distance_km))
    if distance > included_km:
        increment_km = Decimal(str(config["incremento_km"]))
        extra_blocks = ((distance - included_km) / increment_km).to_integral_value(
            rounding=ROUND_CEILING
        )
        fee += extra_blocks * validate_delivery_fee(config["incremento_valor"])

    max_fee = config.get("taxa_maxima")
    if max_fee is not None:
        fee = min(fee, validate_delivery_fee(max_fee))

    return fee.quantize(_MONEY, rounding=ROUND_HALF_UP), distance_km
