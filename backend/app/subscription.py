import logging
from typing import Optional

from .config import settings


logger = logging.getLogger("koma.subscription")

VALID_SUBSCRIPTION_PLANS = {"pocket", "pro", "premium"}
LEGACY_PREMIUM_PLANS = {"bistro", "delivery", "gold", "platinum"}


def normalize_subscription_plan(plan: Optional[str]) -> str:
    normalized = (plan or "pocket").strip().lower()
    if normalized in VALID_SUBSCRIPTION_PLANS:
        return normalized
    if normalized in LEGACY_PREMIUM_PLANS:
        return "premium"
    return "pocket"


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
