from decimal import Decimal

import httpx
import pytest

from app.services.delivery_routes import (
    DeliveryRouteError,
    GoogleRoutesDistanceProvider,
    delivery_fee_for_route_distance,
)


def test_distance_fee_uses_real_route_bracket_and_rejects_out_of_coverage():
    table = [{"ate_km": 3, "taxa": 5}, {"ate_km": 7.5, "taxa": 9.5}]

    assert delivery_fee_for_route_distance(3000, table) == Decimal("5.00")
    assert delivery_fee_for_route_distance(3001, table) == Decimal("9.50")
    with pytest.raises(DeliveryRouteError, match="fora da área"):
        delivery_fee_for_route_distance(7501, table)


def test_google_routes_requests_only_distance_and_caches_per_tenant():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        assert request.headers["x-goog-fieldmask"] == "routes.distanceMeters"
        assert request.headers["x-goog-api-key"] == "server-secret"
        return httpx.Response(200, json={"routes": [{"distanceMeters": 4321}]})

    provider = GoogleRoutesDistanceProvider(
        api_key="server-secret",
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    origin = (-3.7319, -38.5267)
    destination = (-3.725, -38.496)

    assert provider.distance_meters(tenant_id=101, origin=origin, destination=destination) == 4321
    assert provider.distance_meters(tenant_id=101, origin=origin, destination=destination) == 4321
    assert provider.distance_meters(tenant_id=202, origin=origin, destination=destination) == 4321
    assert len(calls) == 2


def test_google_routes_fails_closed_without_server_key():
    provider = GoogleRoutesDistanceProvider(api_key="")
    with pytest.raises(DeliveryRouteError, match="não está configurado"):
        provider.distance_meters(
            tenant_id=1,
            origin=(-3.7319, -38.5267),
            destination=(-3.725, -38.496),
        )
