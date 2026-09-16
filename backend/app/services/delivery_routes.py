"""Distância rodoviária e política canônica de taxa por quilometragem."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
import hashlib
import math
import os
import threading
import time
from typing import Protocol, Sequence

import httpx


class DeliveryRouteError(RuntimeError):
    """Falha segura ao obter uma rota utilizável."""


class RouteDistanceProvider(Protocol):
    def distance_meters(
        self,
        *,
        tenant_id: int,
        origin: tuple[float, float],
        destination: tuple[float, float],
    ) -> int: ...


@dataclass(frozen=True)
class DistanceFeeBracket:
    max_km: Decimal
    fee: Decimal


def validated_coordinates(value: tuple[float, float], *, label: str) -> tuple[float, float]:
    try:
        latitude, longitude = (float(value[0]), float(value[1]))
    except (IndexError, TypeError, ValueError):
        raise DeliveryRouteError(f"As coordenadas de {label} são inválidas.") from None
    if (
        not math.isfinite(latitude)
        or not math.isfinite(longitude)
        or not -90 <= latitude <= 90
        or not -180 <= longitude <= 180
        or (latitude == 0 and longitude == 0)
    ):
        raise DeliveryRouteError(f"As coordenadas de {label} são inválidas.")
    return latitude, longitude


def normalize_distance_fee_brackets(raw: Sequence[object]) -> tuple[DistanceFeeBracket, ...]:
    brackets: list[DistanceFeeBracket] = []
    for item in raw:
        if not isinstance(item, dict):
            raise DeliveryRouteError("A tabela de taxa por distância é inválida.")
        try:
            max_km = Decimal(str(item.get("ate_km", item.get("max_km"))))
            fee = Decimal(str(item.get("taxa")))
        except (InvalidOperation, TypeError, ValueError):
            raise DeliveryRouteError("A tabela de taxa por distância é inválida.") from None
        if not max_km.is_finite() or not fee.is_finite() or max_km <= 0 or fee < 0 or fee > 10_000:
            raise DeliveryRouteError("A tabela de taxa por distância é inválida.")
        brackets.append(DistanceFeeBracket(max_km=max_km, fee=fee.quantize(Decimal("0.01"))))

    ordered = tuple(brackets)
    if (
        not ordered
        or any(
            current.max_km <= previous.max_km
            for previous, current in zip(ordered, ordered[1:])
        )
    ):
        raise DeliveryRouteError("A tabela de taxa por distância é inválida.")
    return ordered


def delivery_fee_for_route_distance(distance_meters: int, raw_brackets: Sequence[object]) -> Decimal:
    if isinstance(distance_meters, bool) or not isinstance(distance_meters, int) or distance_meters < 0:
        raise DeliveryRouteError("A distância calculada para entrega é inválida.")
    distance_km = Decimal(distance_meters) / Decimal(1000)
    for bracket in normalize_distance_fee_brackets(raw_brackets):
        if distance_km <= bracket.max_km:
            return bracket.fee
    raise DeliveryRouteError("O endereço está fora da área de entrega configurada.")


class GoogleRoutesDistanceProvider:
    """Cliente server-side da Routes API, com cache curto e isolado por tenant."""

    endpoint = "https://routes.googleapis.com/directions/v2:computeRoutes"
    _cache: dict[tuple[object, ...], tuple[float, int]] = {}
    _cache_lock = threading.Lock()
    _cache_ttl_seconds = 300.0
    _cache_max_entries = 2048

    def __init__(self, api_key: str | None = None, client: httpx.Client | None = None) -> None:
        configured_key = api_key if api_key is not None else os.getenv("GOOGLE_MAPS_ROUTES_API_KEY", "")
        self._api_key = configured_key.strip()
        self._provider_cache_namespace = hashlib.sha256(
            self._api_key.encode("utf-8")
        ).hexdigest()[:12]
        self._client = client

    def _cache_key(
        self,
        tenant_id: int,
        origin: tuple[float, float],
        destination: tuple[float, float],
    ) -> tuple[object, ...]:
        return (
            "google-routes-v2",
            self._provider_cache_namespace,
            tenant_id,
            *(round(value, 6) for value in (*origin, *destination)),
        )

    def distance_meters(
        self,
        *,
        tenant_id: int,
        origin: tuple[float, float],
        destination: tuple[float, float],
    ) -> int:
        if not self._api_key:
            raise DeliveryRouteError("O cálculo de rota não está configurado no servidor.")

        if isinstance(tenant_id, bool) or not isinstance(tenant_id, int) or tenant_id <= 0:
            raise DeliveryRouteError("O tenant da rota é inválido.")
        origin = validated_coordinates(origin, label="origem")
        destination = validated_coordinates(destination, label="destino")

        cache_key = self._cache_key(tenant_id, origin, destination)
        now = time.monotonic()
        with self._cache_lock:
            cached = self._cache.get(cache_key)
            if cached and cached[0] > now:
                return cached[1]

        payload = {
            "origin": {"location": {"latLng": {"latitude": origin[0], "longitude": origin[1]}}},
            "destination": {
                "location": {"latLng": {"latitude": destination[0], "longitude": destination[1]}}
            },
            "travelMode": "DRIVE",
            "routingPreference": "TRAFFIC_UNAWARE",
            "computeAlternativeRoutes": False,
            "languageCode": "pt-BR",
            "units": "METRIC",
        }
        headers = {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": self._api_key,
            "X-Goog-FieldMask": "routes.distanceMeters",
        }

        try:
            if self._client is not None:
                response = self._client.post(self.endpoint, json=payload, headers=headers, timeout=3.0)
            else:
                with httpx.Client(timeout=3.0, trust_env=False) as client:
                    response = client.post(self.endpoint, json=payload, headers=headers)
            response.raise_for_status()
            routes = response.json().get("routes") or []
            raw_distance = routes[0]["distanceMeters"]
            if isinstance(raw_distance, bool) or not isinstance(raw_distance, int):
                raise ValueError
            distance = raw_distance
            if distance < 0:
                raise ValueError
        except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError) as exc:
            raise DeliveryRouteError("Não foi possível calcular a rota de entrega agora.") from exc

        with self._cache_lock:
            if len(self._cache) >= self._cache_max_entries:
                expired = [key for key, value in self._cache.items() if value[0] <= now]
                for key in expired:
                    self._cache.pop(key, None)
                if len(self._cache) >= self._cache_max_entries:
                    self._cache.pop(next(iter(self._cache)))
            self._cache[cache_key] = (now + self._cache_ttl_seconds, distance)
        return distance
