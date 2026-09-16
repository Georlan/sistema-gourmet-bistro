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


@pytest.mark.parametrize("distance", [-1, 1.5, "1000", True, None])
def test_distance_fee_rejects_invalid_provider_values(distance):
    with pytest.raises(DeliveryRouteError, match="distância calculada"):
        delivery_fee_for_route_distance(distance, [{"ate_km": 3, "taxa": 5}])


@pytest.mark.parametrize(
    "table",
    [
        [],
        [{"ate_km": 0, "taxa": 5}],
        [{"ate_km": 3, "taxa": -1}],
        [{"ate_km": 3, "taxa": 10_001}],
        [{"ate_km": 3, "taxa": "NaN"}],
        [{"ate_km": 3, "taxa": 5}, {"ate_km": 3, "taxa": 6}],
        [{"ate_km": 5, "taxa": 8}, {"ate_km": 3, "taxa": 5}],
    ],
)
def test_distance_fee_rejects_unsafe_tables(table):
    with pytest.raises(DeliveryRouteError, match="tabela"):
        delivery_fee_for_route_distance(1000, table)


def test_distance_fee_boundaries_are_inclusive_and_meter_precise():
    table = [{"ate_km": 1, "taxa": 4}, {"ate_km": 2, "taxa": 7}]
    assert delivery_fee_for_route_distance(999, table) == Decimal("4.00")
    assert delivery_fee_for_route_distance(1000, table) == Decimal("4.00")
    assert delivery_fee_for_route_distance(1001, table) == Decimal("7.00")


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


@pytest.mark.parametrize(
    ("status", "body"),
    [
        (400, {}),
        (403, {}),
        (429, {}),
        (500, {}),
        (503, {}),
        (200, {"routes": []}),
        (200, {"routes": [{}]}),
        (200, {"routes": [{"distanceMeters": None}]}),
        (200, {"routes": [{"distanceMeters": "1000"}]}),
        (200, {"routes": [{"distanceMeters": -1}]}),
    ],
)
def test_google_routes_fails_closed_for_provider_errors(status, body):
    client = httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(status, json=body)))
    provider = GoogleRoutesDistanceProvider(api_key=f"error-key-{status}-{body}", client=client)
    with pytest.raises(DeliveryRouteError, match="Não foi possível"):
        provider.distance_meters(
            tenant_id=991,
            origin=(-3.7319, -38.5267),
            destination=(-3.725, -38.496),
        )


def test_google_routes_fails_closed_on_timeout():
    def timeout_handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("provider timeout", request=request)

    provider = GoogleRoutesDistanceProvider(
        api_key="timeout-key",
        client=httpx.Client(transport=httpx.MockTransport(timeout_handler)),
    )
    with pytest.raises(DeliveryRouteError, match="Não foi possível"):
        provider.distance_meters(
            tenant_id=992,
            origin=(-3.7319, -38.5267),
            destination=(-3.725, -38.496),
        )


@pytest.mark.parametrize(
    ("origin", "destination"),
    [
        ((0, 0), (-3.7, -38.5)),
        ((91, 0), (-3.7, -38.5)),
        ((-3.7, -38.5), (0, 0)),
        ((-3.7, -38.5), (float("nan"), -38.5)),
        ((-3.7, -38.5), (-3.7, float("inf"))),
    ],
)
def test_google_routes_rejects_invalid_coordinates_before_http(origin, destination):
    provider = GoogleRoutesDistanceProvider(
        api_key="server-secret-invalid-coordinates",
        client=httpx.Client(
            transport=httpx.MockTransport(
                lambda request: pytest.fail("HTTP não deveria ser chamado")
            )
        ),
    )
    with pytest.raises(DeliveryRouteError, match="coordenadas"):
        provider.distance_meters(tenant_id=1, origin=origin, destination=destination)


def test_google_routes_cache_separates_tenant_destination_and_provider_key():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(200, json={"routes": [{"distanceMeters": 1200}]})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    first = GoogleRoutesDistanceProvider(api_key="key-a", client=client)
    second = GoogleRoutesDistanceProvider(api_key="key-b", client=client)
    origin = (-3.7319, -38.5267)
    destination = (-3.725, -38.496)

    first.distance_meters(tenant_id=1, origin=origin, destination=destination)
    first.distance_meters(tenant_id=1, origin=origin, destination=(-3.724, -38.496))
    first.distance_meters(tenant_id=2, origin=origin, destination=destination)
    second.distance_meters(tenant_id=1, origin=origin, destination=destination)
    assert len(calls) == 4
