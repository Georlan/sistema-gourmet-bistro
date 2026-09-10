"""Deterministic economics for coupons, loyalty and cashback.

This module deliberately has no database, HTTP or AI dependency. It answers a
narrow question: given an average order, the restaurant's variable-cost ratio,
a minimum contribution margin and the KOMA split, how much incentive can be
offered while preserving that target margin?

The result is an estimate, not a profit guarantee. The caller is responsible
for using realistic cost inputs. Cashback is modeled conservatively as if 100%
of issued credit were eventually redeemed.
"""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Any

CENT = Decimal("0.01")
PERCENT = Decimal("0.01")


def _decimal(value: Decimal | int | float | str) -> Decimal:
    return Decimal(str(value))


def _money(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def _percent(value: Decimal) -> Decimal:
    return value.quantize(PERCENT, rounding=ROUND_HALF_UP)


def _as_float(value: Decimal) -> float:
    return float(value)


def _build_option(
    *,
    key: str,
    label: str,
    incentive_percent: Decimal,
    contribution_before_percent: Decimal,
    minimum_margin_percent: Decimal,
    average_ticket: Decimal,
) -> dict[str, Any]:
    incentive_percent = _percent(max(Decimal("0"), incentive_percent))
    margin_after = _percent(contribution_before_percent - incentive_percent)
    benefit_value = _money(average_ticket * incentive_percent / Decimal("100"))
    contribution_value = _money(average_ticket * margin_after / Decimal("100"))

    if margin_after > 0:
        break_even_lift = _percent(
            incentive_percent / margin_after * Decimal("100")
        )
    else:
        break_even_lift = Decimal("0.00")

    # Keep the points rule easy to explain: R$1 = 1 point. The point monetary
    # value then represents the same effective incentive percentage.
    point_value = (incentive_percent / Decimal("100")).quantize(
        Decimal("0.0001"), rounding=ROUND_HALF_UP
    )

    return {
        "key": key,
        "label": label,
        "incentive_percent": _as_float(incentive_percent),
        "estimated_margin_after_incentive_percent": _as_float(margin_after),
        "estimated_contribution_per_average_order": _as_float(contribution_value),
        "break_even_order_volume_lift_percent": _as_float(break_even_lift),
        "coupon": {
            "percentage_discount": _as_float(incentive_percent),
            "fixed_discount_on_average_ticket": _as_float(benefit_value),
            "suggested_minimum_order_for_fixed_discount": _as_float(average_ticket),
        },
        "cashback": {
            "earn_percent": _as_float(incentive_percent),
            "suggested_max_redemption_percent_per_order": _as_float(incentive_percent),
            "worst_case_redemption_assumption_percent": 100.0,
        },
        "loyalty_points": {
            "points_per_real": 1.0,
            "suggested_point_value_brl": _as_float(point_value),
            "effective_reward_percent": _as_float(incentive_percent),
        },
        "preserves_minimum_margin": margin_after >= minimum_margin_percent,
    }


def calculate_growth_recommendations(
    *,
    average_ticket: Decimal | int | float | str,
    variable_cost_percent: Decimal | int | float | str,
    minimum_margin_percent: Decimal | int | float | str,
    koma_fee_fraction: Decimal | int | float | str,
) -> dict[str, Any]:
    """Return transparent, deterministic incentive recommendations.

    ``variable_cost_percent`` must include costs that scale with the sale
    (for example CMV, packaging, provider fees and taxes), but must *exclude*
    the KOMA split because it is supplied separately from the canonical plan.

    Three options are simple fractions of the mathematically safe incentive
    budget: one third, two thirds and the full ceiling. They are not forecasts
    of customer behavior; every option preserves the requested minimum margin
    under the provided inputs.
    """

    ticket = _money(_decimal(average_ticket))
    variable_cost = _percent(_decimal(variable_cost_percent))
    minimum_margin = _percent(_decimal(minimum_margin_percent))
    koma_fraction = _decimal(koma_fee_fraction)

    if ticket <= 0:
        raise ValueError("Ticket médio deve ser maior que zero.")
    if variable_cost < 0 or variable_cost >= 100:
        raise ValueError("Custo variável percentual deve estar entre 0 e menos de 100.")
    if minimum_margin <= 0 or minimum_margin >= 100:
        raise ValueError("Margem mínima deve estar entre 0 e menos de 100.")
    if koma_fraction < 0 or koma_fraction >= 1:
        raise ValueError("Split KOMA inválido.")

    koma_fee_percent = _percent(koma_fraction * Decimal("100"))
    contribution_before = _percent(
        Decimal("100") - variable_cost - koma_fee_percent
    )
    safe_ceiling = _percent(
        max(Decimal("0"), contribution_before - minimum_margin)
    )

    koma_revenue_per_order = _money(ticket * koma_fraction)
    contribution_before_value = _money(
        ticket * contribution_before / Decimal("100")
    )

    warnings: list[str] = []
    if safe_ceiling <= 0:
        warnings.append(
            "Com estes custos e margem mínima, não há orçamento seguro para incentivo."
        )
    if contribution_before <= 0:
        warnings.append(
            "Os custos variáveis informados consomem toda a contribuição antes de qualquer benefício."
        )

    thirds = (
        ("conservative", "Conservador", safe_ceiling / Decimal("3")),
        ("balanced", "Equilibrado", safe_ceiling * Decimal("2") / Decimal("3")),
        ("limit", "Limite calculado", safe_ceiling),
    )
    options = [
        _build_option(
            key=key,
            label=label,
            incentive_percent=min(_percent(rate), safe_ceiling),
            contribution_before_percent=contribution_before,
            minimum_margin_percent=minimum_margin,
            average_ticket=ticket,
        )
        for key, label, rate in thirds
        if safe_ceiling > 0
    ]

    return {
        "inputs": {
            "average_ticket": _as_float(ticket),
            "variable_cost_percent_excluding_koma": _as_float(variable_cost),
            "minimum_margin_percent": _as_float(minimum_margin),
        },
        "economics": {
            "koma_fee_percent": _as_float(koma_fee_percent),
            "koma_revenue_per_average_order": _as_float(koma_revenue_per_order),
            "contribution_margin_before_incentive_percent": _as_float(contribution_before),
            "contribution_before_incentive_per_average_order": _as_float(contribution_before_value),
            "safe_incentive_ceiling_percent": _as_float(safe_ceiling),
            "safe_incentive_ceiling_on_average_order": _as_float(
                _money(ticket * safe_ceiling / Decimal("100"))
            ),
        },
        "options": options,
        "warnings": warnings,
        "assumptions": [
            "O custo variável informado exclui o split KOMA, calculado separadamente pelo plano.",
            "Cashback considera 100% de resgate futuro para não superestimar margem.",
            "Aumento de frequência, conversão e ticket não é presumido; deve ser medido depois.",
            "As sugestões são estimativas econômicas, não garantia de lucro.",
        ],
    }
