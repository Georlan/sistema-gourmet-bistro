import json
from decimal import Decimal
from pathlib import Path

from app.subscription import (
    LEGACY_V25_MARKETPLACE_RATES,
    LEGACY_V25_MONTHLY_PRICES,
    SUBSCRIPTION_MARKETPLACE_RATES,
    SUBSCRIPTION_MONTHLY_PRICES,
)


REPO_ROOT = Path(__file__).resolve().parents[2]
CONTRACT_PATH = REPO_ROOT / "product-contract.json"
FRONTEND_CATALOG = REPO_ROOT / "src" / "config" / "subscriptionPlans.ts"

EXPECTED_PRICES = {
    "pocket": Decimal("39.00"),
    "pro": Decimal("129.00"),
    "premium": Decimal("249.00"),
}

EXPECTED_RATES = {
    "pocket": Decimal("0.0179"),
    "pro": Decimal("0.0050"),
    "premium": Decimal("0.0020"),
}

LEGACY_RATES = {
    "pocket": Decimal("0.0149"),
    "pro": Decimal("0.0069"),
    "premium": Decimal("0.0029"),
}


def test_commercial_catalog_is_synced_across_frontend_and_payment_backend():
    with open(CONTRACT_PATH, "r", encoding="utf-8") as f:
        contract = json.load(f)

    # O frontend consome diretamente o contrato canônico
    source = FRONTEND_CATALOG.read_text(encoding="utf-8")
    assert "export const ANNUAL_DISCOUNT_RATE = 0.1;" in source
    assert "product-contract.json" in source

    for plan_id in ("pocket", "pro", "premium"):
        contract_plan = contract["plans"][plan_id]
        plan_price = Decimal(str(contract_plan["price"])).quantize(Decimal("0.01"))
        plan_rate = Decimal(str(contract_plan["split_fee_rate"]))

        assert plan_price == EXPECTED_PRICES[plan_id]
        assert plan_rate == EXPECTED_RATES[plan_id]
        assert SUBSCRIPTION_MONTHLY_PRICES[plan_id] == plan_price
        assert SUBSCRIPTION_MARKETPLACE_RATES[plan_id] == plan_rate


def test_frontend_comparison_labels_match_financial_rates():
    with open(CONTRACT_PATH, "r", encoding="utf-8") as f:
        contract = json.load(f)

    matrix = contract.get("comparison_matrix", [])
    taxa_row = next(r for r in matrix if "Taxa KÔMA" in r["feature"])
    assert taxa_row["pocket"] == "1,79%"
    assert taxa_row["pro"] == "0,50%"
    assert taxa_row["premium"] == "0,20%"


def test_legacy_v25_fallback_stays_frozen_when_current_catalog_changes():
    assert LEGACY_V25_MONTHLY_PRICES == {
        "pocket": Decimal("109.00"),
        "pro": Decimal("209.00"),
        "premium": Decimal("309.00"),
    }
    assert LEGACY_V25_MARKETPLACE_RATES == LEGACY_RATES
    assert LEGACY_V25_MARKETPLACE_RATES is not SUBSCRIPTION_MARKETPLACE_RATES
