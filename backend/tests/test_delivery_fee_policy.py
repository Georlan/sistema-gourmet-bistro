from decimal import Decimal

import pytest

from app.services.delivery_fee_policy import (
    haversine_distance_km,
    normalize_distance_fee_config,
    normalize_neighborhood,
    normalize_neighborhood_fee_table,
    resolve_distance_delivery_fee,
    validate_delivery_fee,
)


@pytest.mark.parametrize("value", [-1, 10000.01, float("nan"), float("inf"), "x", None])
def test_validate_delivery_fee_rejects_unsafe_values(value):
    with pytest.raises(ValueError, match="inválida"):
        validate_delivery_fee(value)


def test_validate_delivery_fee_accepts_zero_and_limit():
    assert validate_delivery_fee(0) == Decimal("0.00")
    assert validate_delivery_fee("10000") == Decimal("10000.00")


def test_neighborhood_normalization_only_folds_case_and_spaces():
    assert normalize_neighborhood("  CENTRO   Sul ") == "centro sul"
    assert normalize_neighborhood("Vila Nova") != normalize_neighborhood("Vila Nova Esperança")


def test_neighborhood_table_rejects_duplicates_after_safe_normalization():
    with pytest.raises(ValueError, match="duplicado"):
        normalize_neighborhood_fee_table([
            {"bairro": "Centro", "taxa": 5},
            {"bairro": "  centro ", "taxa": 8},
        ])


def test_neighborhood_table_normalizes_names_and_fees():
    assert normalize_neighborhood_fee_table([
        {"bairro": "  Praia   do Futuro ", "taxa": "7.5"},
    ]) == ({"bairro": "Praia do Futuro", "taxa": 7.5},)


def test_distance_config_normalizes_minimum_increment_and_limits():
    assert normalize_distance_fee_config([{
        "taxa_minima": 5,
        "km_inclusos": 3,
        "incremento_valor": 1,
        "incremento_km": 3,
        "taxa_maxima": 7,
        "distancia_maxima_km": 12,
    }]) == {
        "taxa_minima": 5.0,
        "km_inclusos": 3.0,
        "incremento_valor": 1.0,
        "incremento_km": 3.0,
        "taxa_maxima": 7.0,
        "distancia_maxima_km": 12.0,
        "fallback_sem_localizacao": "minima",
    }


def test_distance_fee_uses_minimum_without_coordinates():
    fee, distance = resolve_distance_delivery_fee(
        [{
            "taxa_minima": 5,
            "km_inclusos": 3,
            "incremento_valor": 1,
            "incremento_km": 3,
            "taxa_maxima": 7,
            "distancia_maxima_km": 0,
        }],
        origin_latitude=None,
        origin_longitude=None,
        destination_latitude=-3.73,
        destination_longitude=-38.50,
    )
    assert fee == Decimal("5.00")
    assert distance is None


def test_distance_fee_increments_and_respects_cap():
    raw = [{
        "taxa_minima": 5,
        "km_inclusos": 3,
        "incremento_valor": 1,
        "incremento_km": 3,
        "taxa_maxima": 7,
        "distancia_maxima_km": 0,
    }]
    near_fee, near_distance = resolve_distance_delivery_fee(
        raw,
        origin_latitude=-3.7319,
        origin_longitude=-38.5267,
        destination_latitude=-3.7319,
        destination_longitude=-38.4816,
    )
    assert 4 < near_distance < 6
    assert near_fee == Decimal("6.00")

    far_fee, far_distance = resolve_distance_delivery_fee(
        raw,
        origin_latitude=-3.7319,
        origin_longitude=-38.5267,
        destination_latitude=-3.7319,
        destination_longitude=-38.40,
    )
    assert far_distance > 9
    assert far_fee == Decimal("7.00")


def test_distance_fee_rejects_destination_beyond_configured_limit():
    with pytest.raises(ValueError, match="fora do limite"):
        resolve_distance_delivery_fee(
            [{
                "taxa_minima": 5,
                "km_inclusos": 3,
                "incremento_valor": 1,
                "incremento_km": 3,
                "taxa_maxima": 7,
                "distancia_maxima_km": 4,
            }],
            origin_latitude=-3.7319,
            origin_longitude=-38.5267,
            destination_latitude=-3.7319,
            destination_longitude=-38.4816,
        )


def test_haversine_same_point_is_zero():
    assert haversine_distance_km(-3.7319, -38.5267, -3.7319, -38.5267) == 0.0


def test_simplified_distance_config_uses_only_minimum_and_per_km_value():
    assert normalize_distance_fee_config([{
        "taxa_minima": 5,
        "valor_por_km": 1,
    }]) == {
        "taxa_minima": 5.0,
        "valor_por_km": 1.0,
        "fallback_sem_localizacao": "minima",
    }


def test_simplified_distance_fee_is_minimum_then_linear_per_km():
    raw = [{"taxa_minima": 5, "valor_por_km": 1}]

    near_fee, near_distance = resolve_distance_delivery_fee(
        raw,
        origin_latitude=-3.7319,
        origin_longitude=-38.5267,
        destination_latitude=-3.7319,
        destination_longitude=-38.50,
    )
    assert near_distance < 5
    assert near_fee == Decimal("5.00")

    farther_fee, farther_distance = resolve_distance_delivery_fee(
        raw,
        origin_latitude=-3.7319,
        origin_longitude=-38.5267,
        destination_latitude=-3.7319,
        destination_longitude=-38.4725,
    )
    assert 5 < farther_distance < 7
    assert farther_fee == Decimal("6.01")
