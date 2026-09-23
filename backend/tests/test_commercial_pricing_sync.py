import re
from decimal import Decimal
from pathlib import Path

from app.subscription import (
    LEGACY_V25_MARKETPLACE_RATES,
    LEGACY_V25_MONTHLY_PRICES,
    SUBSCRIPTION_MARKETPLACE_RATES,
    SUBSCRIPTION_MONTHLY_PRICES,
)


REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_CATALOG = REPO_ROOT / "src" / "config" / "subscriptionPlans.ts"

EXPECTED_PRICES = {
    "pocket": Decimal("39.90"),
    "pro": 129,
    "premium": 249,
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


def _frontend_plan(source: str, plan_id: str) -> tuple[Decimal, Decimal]:
    match = re.search(
        rf"id:\s*'{plan_id}'.*?price:\s*([0-9.]+).*?splitFeeRate:\s*([0-9.]+)",
        source,
        flags=re.DOTALL,
    )
    assert match is not None, f"Plano {plan_id} não encontrado no catálogo frontend"
    return Decimal(match.group(1)), Decimal(match.group(2))


def test_commercial_catalog_is_synced_across_frontend_and_payment_backend():
    source = FRONTEND_CATALOG.read_text(encoding="utf-8")

    assert "export const ANNUAL_DISCOUNT_RATE = 0.1;" in source

    for plan_id in ("pocket", "pro", "premium"):
        frontend_price, frontend_rate = _frontend_plan(source, plan_id)
        assert frontend_price == EXPECTED_PRICES[plan_id]
        assert frontend_rate == EXPECTED_RATES[plan_id]
        assert SUBSCRIPTION_MONTHLY_PRICES[plan_id] == Decimal(str(EXPECTED_PRICES[plan_id])).quantize(Decimal("0.01"))
        assert SUBSCRIPTION_MARKETPLACE_RATES[plan_id] == EXPECTED_RATES[plan_id]


def test_frontend_comparison_labels_match_financial_rates():
    source = FRONTEND_CATALOG.read_text(encoding="utf-8")
    assert "pocket: '1,79%'" in source
    assert "pro: '0,50%'" in source
    assert "premium: '0,20%'" in source


def test_legacy_v25_fallback_stays_frozen_when_current_catalog_changes():
    assert LEGACY_V25_MONTHLY_PRICES == {
        "pocket": Decimal("109.00"),
        "pro": Decimal("209.00"),
        "premium": Decimal("309.00"),
    }
    assert LEGACY_V25_MARKETPLACE_RATES == LEGACY_RATES
    assert LEGACY_V25_MARKETPLACE_RATES is not SUBSCRIPTION_MARKETPLACE_RATES
