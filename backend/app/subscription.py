import logging
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

from .config import settings


logger = logging.getLogger("koma.subscription")

VALID_SUBSCRIPTION_PLANS = {"pocket", "pro", "premium"}
LEGACY_PREMIUM_PLANS = {"bistro", "delivery", "gold", "platinum"}
VALID_BILLING_CYCLES = {"monthly", "annual"}

# Catálogo financeiro canônico do servidor. Valores em centavos evitam ponto
# flutuante em cobrança e MRR. O frontend mantém o catálogo de apresentação e
# o teste de sincronismo impede divergência entre as duas fronteiras.
SUBSCRIPTION_MONTHLY_PRICES_CENTS: dict[str, int] = {
    "pocket": 10_900,
    "pro": 20_900,
    "premium": 30_900,
}
ANNUAL_DISCOUNT_RATE = Decimal("0.10")

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


def normalize_billing_cycle(cycle: Optional[str]) -> str:
    normalized = (cycle or "").strip().lower()
    if normalized not in VALID_BILLING_CYCLES:
        raise ValueError("Ciclo de cobrança inválido. Use monthly ou annual.")
    return normalized


def subscription_monthly_price_cents(stored_plan: Optional[str]) -> int:
    return SUBSCRIPTION_MONTHLY_PRICES_CENTS[normalize_subscription_plan(stored_plan)]


def subscription_period_amount_cents(stored_plan: Optional[str], billing_cycle: str) -> int:
    """Valor fixo contratado por período, em centavos.

    No anual, o desconto de 10% incide apenas sobre a mensalidade fixa; a taxa
    variável de marketplace continua sendo calculada por pedido pago.
    """
    cycle = normalize_billing_cycle(billing_cycle)
    monthly_cents = subscription_monthly_price_cents(stored_plan)
    if cycle == "monthly":
        return monthly_cents

    annual = (
        Decimal(monthly_cents)
        * Decimal(12)
        * (Decimal("1") - ANNUAL_DISCOUNT_RATE)
    ).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return int(annual)


def subscription_mrr_cents(stored_plan: Optional[str], billing_cycle: str) -> int:
    """Mensaliza o valor contratado para composição de MRR."""
    cycle = normalize_billing_cycle(billing_cycle)
    if cycle == "monthly":
        return subscription_monthly_price_cents(stored_plan)
    return int(
        (Decimal(subscription_period_amount_cents(stored_plan, cycle)) / Decimal(12))
        .quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    )


def subscription_marketplace_rate(stored_plan: Optional[str]) -> Decimal:
    """Retorna a taxa comercial do plano contratado, sem aplicar override de teste."""
    return SUBSCRIPTION_MARKETPLACE_RATES[normalize_subscription_plan(stored_plan)]


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
