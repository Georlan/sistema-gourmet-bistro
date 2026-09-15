from __future__ import annotations

SAAS_TRIAL_DAYS = 7

# Checkout SaaS canônico do KÔMA: exatamente três opções visíveis.
# - cartão: recorrência automática;
# - Pix: cobrança avulsa interoperável por QR Code/Copia e Cola;
# - Saldo Mercado Pago: autorização recorrente no provedor.
CHECKOUT_PAYMENT_METHODS = frozenset({"credit_card", "pix", "account_money"})

# Meios que possuem mandato/assinatura automática no provedor.
# `pix_automatic` permanece somente para reconciliação de tentativas históricas;
# ele não faz parte do checkout novo.
RECURRING_TRIAL_PAYMENT_METHODS = frozenset({"credit_card", "pix_automatic", "account_money"})

# Todo meio oferecido no checkout preserva a mesma regra de trial. Para Pix não
# existe cobrança antecipada: o QR da mensalidade é criado apenas quando houver
# valor devido depois do onboarding + 7 dias grátis.
TRIAL_ELIGIBLE_PAYMENT_METHODS = CHECKOUT_PAYMENT_METHODS

LEGACY_CHECKOUT_PAYMENT_METHODS = frozenset({"pix_automatic"})


def is_checkout_payment_method(payment_method_type: str | None) -> bool:
    return (payment_method_type or "").strip().lower() in CHECKOUT_PAYMENT_METHODS


def is_trial_eligible_payment_method(payment_method_type: str | None) -> bool:
    return (payment_method_type or "").strip().lower() in TRIAL_ELIGIBLE_PAYMENT_METHODS


def is_recurring_trial_payment_method(payment_method_type: str | None) -> bool:
    return (payment_method_type or "").strip().lower() in RECURRING_TRIAL_PAYMENT_METHODS


def assert_no_legacy_checkout_payment(payment_method_type: str | None) -> None:
    normalized = (payment_method_type or "").strip().lower()
    if normalized in LEGACY_CHECKOUT_PAYMENT_METHODS:
        raise ValueError(
            "Pix Automático hospedado não faz parte do checkout KÔMA. "
            "Use 'pix' para QR Code/Copia e Cola universal."
        )


# Alias mantido para chamadas/testes antigos durante a transição.
def assert_no_upfront_subscription_payment(payment_method_type: str | None) -> None:
    assert_no_legacy_checkout_payment(payment_method_type)
