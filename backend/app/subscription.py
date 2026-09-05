import logging
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

from .config import settings


logger = logging.getLogger("koma.subscription")

VALID_SUBSCRIPTION_PLANS = {"pocket", "pro", "premium"}
LEGACY_PREMIUM_PLANS = {"bistro", "delivery", "gold", "platinum"}
ANNUAL_DISCOUNT_RATE = Decimal("0.10")

# Fonte de verdade financeira no servidor para a mensalidade fixa do SaaS.
SUBSCRIPTION_MONTHLY_PRICES: dict[str, Decimal] = {
    "pocket": Decimal("109.00"),
    "pro": Decimal("209.00"),
    "premium": Decimal("309.00"),
}

# Fonte de verdade financeira no servidor para a comissão KÔMA sobre pedidos
# online pagos. Valores são frações decimais: 0.0149 = 1,49%.
SUBSCRIPTION_MARKETPLACE_RATES: dict[str, Decimal] = {
    "pocket": Decimal("0.0149"),
    "pro": Decimal("0.0069"),
    "premium": Decimal("0.0029"),
}


def normalize_subscription_plan(plan: Optional[str]) -> str:
    normalized = (plan or "pocket").strip().lower()
    if normalized in VALID_SUBSCRIPTION_PLANS:
        return normalized
    if normalized in LEGACY_PREMIUM_PLANS:
        return "premium"
    return "pocket"


def subscription_marketplace_rate(stored_plan: Optional[str]) -> Decimal:
    """Retorna a taxa comercial do plano contratado, sem aplicar override de teste."""
    return SUBSCRIPTION_MARKETPLACE_RATES[normalize_subscription_plan(stored_plan)]


def subscription_monthly_price(stored_plan: Optional[str]) -> Decimal:
    return SUBSCRIPTION_MONTHLY_PRICES[normalize_subscription_plan(stored_plan)]


def subscription_annual_total(stored_plan: Optional[str]) -> Decimal:
    monthly = subscription_monthly_price(stored_plan)
    return (
        monthly * Decimal("12") * (Decimal("1") - ANNUAL_DISCOUNT_RATE)
    ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def subscription_annual_monthly_equivalent(stored_plan: Optional[str]) -> Decimal:
    return (subscription_annual_total(stored_plan) / Decimal("12")).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP
    )


def _test_premium_restaurant_ids() -> frozenset[int]:
    raw_ids = settings.KOMA_TEST_PREMIUM_RESTAURANTE_IDS
    parsed_ids: set[int] = set()

    for raw_id in raw_ids.split(","):
        candidate = raw_id.strip()
        if not candidate:
            continue
        try:
            restaurant_id = int(candidate)
        except ValueError:
            logger.warning(
                "KOMA_TEST_PREMIUM_RESTAURANTE_IDS contém ID inválido: %r",
                candidate,
            )
            continue
        if restaurant_id > 0:
            parsed_ids.add(restaurant_id)

    return frozenset(parsed_ids)


def is_test_premium_restaurant(restaurante_id: int) -> bool:
    return restaurante_id in _test_premium_restaurant_ids()


def get_effective_subscription_plan(
    restaurante_id: int,
    stored_plan: Optional[str],
) -> str:
    if is_test_premium_restaurant(restaurante_id):
        return "premium"
    return normalize_subscription_plan(stored_plan)


def subscription_has_printing(
    restaurante_id: int,
    stored_plan: Optional[str],
) -> bool:
    return get_effective_subscription_plan(restaurante_id, stored_plan) != "pocket"
