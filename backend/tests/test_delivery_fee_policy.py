from decimal import Decimal

import pytest

from app.services.delivery_fee_policy import (
    normalize_neighborhood,
    normalize_neighborhood_fee_table,
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
