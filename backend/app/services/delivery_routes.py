"""Distância rodoviária e política canônica de taxa por quilometragem."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
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
        if max_km <= 0 or fee < 0:
            raise DeliveryRouteError("A tabela de taxa por distância é inválida.")
        brackets.append(DistanceFeeBracket(max_km=max_km, fee=fee.quantize(Decimal("0.01"))))

    ordered = tuple(sorted(brackets, key=lambda bracket: bracket.max_km))
    if not ordered or len({bracket.max_km for bracket in ordered}) != len(ordered):
        raise DeliveryRouteError("A tabela de taxa por distância é inválida.")
    return ordered


def delivery_fee_for_route_distance(distance_meters: int, raw_brackets: Sequence[object]) -> Decimal:
    if distance_meters < 0:
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
        self._client = client

    @staticmethod
    def _cache_key(
        tenant_id: int,
        origin: tuple[float, float],
        destination: tuple[float, float],
    ) -> tuple[object, ...]:
        return (tenant_id, *(round(value, 5) for value in (*origin, *destination)))

    def distance_meters(
        self,
        *,
        tenant_id: int,
        origin: tuple[float, float],
        destination: tuple[float, float],
    ) -> int:
        if not self._api_key:
            raise DeliveryRouteError("O cálculo de rota não está configurado no servidor.")

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
                response = self._client.post(self.endpoint, json=payload, headers=headers)
            else:
                with httpx.Client(timeout=3.0, trust_env=False) as client:
                    response = client.post(self.endpoint, json=payload, headers=headers)
            response.raise_for_status()
            routes = response.json().get("routes") or []
            distance = int(routes[0]["distanceMeters"])
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
