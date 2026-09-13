from __future__ import annotations

SAAS_TRIAL_DAYS = 7

# Regra canônica do checkout SaaS KÔMA:
# todo método oferecido ao cliente precisa apenas autorizar a recorrência hoje,
# manter R$ 0 de mensalidade fixa durante o trial e cobrar automaticamente
# somente após o término dos 7 dias grátis.
RECURRING_TRIAL_PAYMENT_METHODS = frozenset({"credit_card", "pix_automatic"})

# Compatibilidade histórica apenas para detectar e rejeitar tentativas antigas.
# O Pix avulso/anual não é mais um método válido para novas contratações SaaS.
LEGACY_UPFRONT_PAYMENT_METHODS = frozenset({"pix"})


def is_recurring_trial_payment_method(payment_method_type: str | None) -> bool:
    return (payment_method_type or "").strip().lower() in RECURRING_TRIAL_PAYMENT_METHODS


def assert_no_upfront_subscription_payment(payment_method_type: str | None) -> None:
    normalized = (payment_method_type or "").strip().lower()
    if normalized in LEGACY_UPFRONT_PAYMENT_METHODS:
        raise ValueError(
            "Pix avulso antecipado foi removido do checkout SaaS. "
            "Use Pix Automático com 7 dias grátis e cobrança recorrente posterior."
        )
