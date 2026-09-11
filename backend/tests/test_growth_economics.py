from decimal import Decimal

import pytest

from app.domain.growth_economics import (
    calculate_growth_recommendations,
    suggest_loyalty_reward_percent,
)
from app.subscription import subscription_marketplace_rate


def test_growth_recommendation_preserves_target_margin_and_koma_split():
    result = calculate_growth_recommendations(
        average_ticket="100.00",
        variable_cost_percent="60.00",
        minimum_margin_percent="20.00",
        koma_fee_fraction=subscription_marketplace_rate("pocket"),
    )

    economics = result["economics"]
    assert economics["koma_fee_percent"] == 1.49
    assert economics["koma_revenue_per_average_order"] == 1.49
    assert economics["contribution_margin_before_incentive_percent"] == 38.51
    assert economics["safe_incentive_ceiling_percent"] == 18.51
    assert economics["safe_incentive_ceiling_on_average_order"] == 18.51

    conservative, balanced, limit = result["options"]
    assert conservative["incentive_percent"] == 6.17
    assert balanced["incentive_percent"] == 12.34
    assert limit["incentive_percent"] == 18.51
    assert limit["estimated_margin_after_incentive_percent"] == 20.0
    assert all(option["preserves_minimum_margin"] for option in result["options"])

    assert balanced["coupon"]["fixed_discount_on_average_ticket"] == 12.34
    assert balanced["coupon"]["suggested_minimum_order_for_fixed_discount"] == 100.0
    assert balanced["cashback"]["earn_percent"] == 12.34
    assert balanced["cashback"]["worst_case_redemption_assumption_percent"] == 100.0
    assert balanced["loyalty_points"]["points_per_real"] == 1.0
    assert balanced["loyalty_points"]["suggested_point_value_brl"] == 0.1234


def test_growth_recommendation_does_not_invent_budget_when_target_margin_is_unavailable():
    result = calculate_growth_recommendations(
        average_ticket=50,
        variable_cost_percent=80,
        minimum_margin_percent=20,
        koma_fee_fraction=subscription_marketplace_rate("pro"),
    )

    assert result["economics"]["contribution_margin_before_incentive_percent"] == 19.31
    assert result["economics"]["safe_incentive_ceiling_percent"] == 0.0
    assert result["options"] == []
    assert result["warnings"]


def test_loyalty_auto_rate_uses_conservative_fallback_without_cost_coverage():
    assert suggest_loyalty_reward_percent(None) == 2.0


def test_loyalty_auto_rate_consumes_at_most_ten_percent_of_known_contribution():
    assert suggest_loyalty_reward_percent(38.51) == 3.5
    assert suggest_loyalty_reward_percent(20) == 2.0
    assert suggest_loyalty_reward_percent(10) == 1.0
    assert suggest_loyalty_reward_percent(5) == 0.5
    assert suggest_loyalty_reward_percent(4.9) == 0.0


def test_loyalty_auto_rate_is_capped_at_five_percent():
    assert suggest_loyalty_reward_percent(80) == 5.0


@pytest.mark.parametrize(
    ("plan", "expected"),
    [
        ("pocket", Decimal("0.0149")),
        ("pro", Decimal("0.0069")),
        ("premium", Decimal("0.0029")),
    ],
)
def test_growth_economics_uses_existing_canonical_plan_rates(plan, expected):
    assert subscription_marketplace_rate(plan) == expected


def test_growth_economics_rejects_invalid_inputs():
    with pytest.raises(ValueError, match="Ticket médio"):
        calculate_growth_recommendations(
            average_ticket=0,
            variable_cost_percent=50,
            minimum_margin_percent=20,
            koma_fee_fraction=Decimal("0.0149"),
        )

    with pytest.raises(ValueError, match="Custo variável"):
        calculate_growth_recommendations(
            average_ticket=100,
            variable_cost_percent=100,
            minimum_margin_percent=20,
            koma_fee_fraction=Decimal("0.0149"),
        )
