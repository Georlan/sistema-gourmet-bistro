from types import SimpleNamespace

from app.delivery_address_snapshot import ComandaDeliveryAddressSnapshot
from app.models import Comanda, Restaurante
from app.services.delivery_fee_suggestion import suggest_delivery_fee


class _FakeQuery:
    def __init__(self, rows):
        self.rows = rows

    def filter(self, *_args, **_kwargs):
        return self

    def order_by(self, *_args, **_kwargs):
        return self

    def limit(self, *_args, **_kwargs):
        return self

    def first(self):
        return self.rows[0] if self.rows else None

    def all(self):
        return list(self.rows)


class _FakeDb:
    def __init__(self, restaurant, orders=None, snapshots=None):
        self.restaurant = restaurant
        self.orders = orders or []
        self.snapshots = snapshots or []

    def query(self, model):
        if model is Restaurante:
            return _FakeQuery([self.restaurant] if self.restaurant is not None else [])
        if model is Comanda:
            return _FakeQuery(self.orders)
        if model is ComandaDeliveryAddressSnapshot:
            return _FakeQuery(self.snapshots)
        raise AssertionError(f"query inesperada: {model}")


def test_delivery_suggestion_uses_safe_default_without_origin():
    result = suggest_delivery_fee(
        _FakeDb(SimpleNamespace(latitude=None, longitude=None)),
        restaurante_id=1,
    )

    assert result["source"] == "default"
    assert result["taxa_minima"] == 5.0
    assert result["valor_por_km"] == 1.0
    assert result["sample_size"] == 0


def test_delivery_suggestion_uses_completed_delivery_history_when_sample_is_sufficient():
    restaurant = SimpleNamespace(latitude=-3.7319, longitude=-38.5267)
    orders = [
        SimpleNamespace(id=f"order-{index}", delivery_taxa=fee)
        for index, fee in enumerate([5, 5, 5.5, 6, 6.5, 7], start=1)
    ]
    snapshots = [
        SimpleNamespace(
            comanda_id=f"order-{index}",
            payload={"latitude": -3.7319, "longitude": longitude},
        )
        for index, longitude in enumerate(
            [-38.5177, -38.5087, -38.4997, -38.4907, -38.4817, -38.4727],
            start=1,
        )
    ]

    result = suggest_delivery_fee(
        _FakeDb(restaurant, orders=orders, snapshots=snapshots),
        restaurante_id=1,
    )

    assert result["source"] == "history"
    assert result["sample_size"] == 6
    assert result["taxa_minima"] >= 1
    assert result["valor_por_km"] >= 0.5
