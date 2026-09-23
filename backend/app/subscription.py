import logging
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

from .config import settings


logger = logging.getLogger("koma.subscription")

VALID_SUBSCRIPTION_PLANS = {"pocket", "pro", "premium"}
LEGACY_PREMIUM_PLANS = {"bistro", "delivery", "gold", "platinum"}
ANNUAL_DISCOUNT_RATE = Decimal("0.10")
COMMERCIAL_PRICING_VERSION = "2026-09-pocket-3990"

# Catálogo comercial vigente para NOVAS contratações.
#
# IMPORTANTE: estas estruturas podem mudar quando uma nova versão comercial entrar
# em vigor. Elas nunca devem ser usadas, isoladamente, para recalcular os termos de
# um tenant que já aceitou um contrato.
SUBSCRIPTION_MONTHLY_PRICES: dict[str, Decimal] = {
    "pocket": Decimal("39.90"),
    "pro": Decimal("129.00"),
    "premium": Decimal("249.00"),
}

SUBSCRIPTION_MARKETPLACE_RATES: dict[str, Decimal] = {
    "pocket": Decimal("0.0179"),
    "pro": Decimal("0.0050"),
    "premium": Decimal("0.0020"),
}

# Fallback congelado para tenants legados que ainda não possuem um
# ContractAcceptance vinculado. Quando o catálogo vigente mudar, este snapshot
# NÃO deve acompanhar a mudança: ele representa os termos comerciais anteriores
# já praticados antes do versionamento contratual ser a autoridade do split.
LEGACY_V25_MONTHLY_PRICES: dict[str, Decimal] = {
    "pocket": Decimal("109.00"),
    "pro": Decimal("209.00"),
    "premium": Decimal("309.00"),
}

LEGACY_V25_MARKETPLACE_RATES: dict[str, Decimal] = {
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
    """Retorna a taxa do catálogo vigente para novas vendas/cálculos públicos."""
    return SUBSCRIPTION_MARKETPLACE_RATES[normalize_subscription_plan(stored_plan)]


def legacy_v25_marketplace_rate(stored_plan: Optional[str]) -> Decimal:
    """Fallback imutável para tenants sem aceite contratual comercial vinculado."""
    return LEGACY_V25_MARKETPLACE_RATES[normalize_subscription_plan(stored_plan)]


def legacy_v25_monthly_price(stored_plan: Optional[str]) -> Decimal:
    """Mensalidade fixa imutável para billing legado sem snapshot vinculado."""
    return LEGACY_V25_MONTHLY_PRICES[normalize_subscription_plan(stored_plan)]


def legacy_v25_annual_total(stored_plan: Optional[str]) -> Decimal:
    monthly = legacy_v25_monthly_price(stored_plan)
    return (
        monthly * Decimal("12") * (Decimal("1") - ANNUAL_DISCOUNT_RATE)
    ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


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
