import re
from decimal import Decimal
from pathlib import Path

from app.subscription import (
    ANNUAL_DISCOUNT_RATE,
    SUBSCRIPTION_MARKETPLACE_RATES,
    SUBSCRIPTION_MONTHLY_PRICES_CENTS,
)


REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_CATALOG = REPO_ROOT / "src" / "config" / "subscriptionPlans.ts"

EXPECTED_PRICES = {
    "pocket": 109,
    "pro": 209,
    "premium": 309,
}

EXPECTED_RATES = {
    "pocket": Decimal("0.0149"),
    "pro": Decimal("0.0069"),
    "premium": Decimal("0.0029"),
}


def _frontend_plan(source: str, plan_id: str) -> tuple[int, Decimal]:
    match = re.search(
        rf"id:\s*'{plan_id}'.*?price:\s*(\d+).*?splitFeeRate:\s*([0-9.]+)",
        source,
        flags=re.DOTALL,
    )
    assert match is not None, f"Plano {plan_id} não encontrado no catálogo frontend"
    return int(match.group(1)), Decimal(match.group(2))


def test_commercial_catalog_is_synced_across_frontend_and_payment_backend():
    source = FRONTEND_CATALOG.read_text(encoding="utf-8")

    assert "export const ANNUAL_DISCOUNT_RATE = 0.1;" in source
    assert ANNUAL_DISCOUNT_RATE == Decimal("0.10")

    for plan_id in ("pocket", "pro", "premium"):
        frontend_price, frontend_rate = _frontend_plan(source, plan_id)
        assert frontend_price == EXPECTED_PRICES[plan_id]
        assert frontend_rate == EXPECTED_RATES[plan_id]
        assert SUBSCRIPTION_MONTHLY_PRICES_CENTS[plan_id] == EXPECTED_PRICES[plan_id] * 100
        assert SUBSCRIPTION_MARKETPLACE_RATES[plan_id] == EXPECTED_RATES[plan_id]


def test_frontend_comparison_labels_match_financial_rates():
    source = FRONTEND_CATALOG.read_text(encoding="utf-8")
    assert "pocket: '1,49%'" in source
    assert "pro: '0,69%'" in source
    assert "premium: '0,29%'" in source
