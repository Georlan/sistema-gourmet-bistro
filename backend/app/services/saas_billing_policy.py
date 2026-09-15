from __future__ import annotations

SAAS_TRIAL_DAYS = 7

# Checkout SaaS canônico do KÔMA: exatamente três opções visíveis.
# - cartão: recorrência automática;
# - Pix Automático: autorização recorrente no provedor;
# - Saldo Mercado Pago: autorização recorrente no provedor.
CHECKOUT_PAYMENT_METHODS = frozenset({"credit_card", "pix_automatic", "account_money"})

# Os três meios do checkout possuem mandato/assinatura automática no provedor.
RECURRING_TRIAL_PAYMENT_METHODS = CHECKOUT_PAYMENT_METHODS

# Todos preservam a mesma regra comercial: R$ 0 hoje e 7 dias grátis completos
# somente depois da implantação essencial.
TRIAL_ELIGIBLE_PAYMENT_METHODS = CHECKOUT_PAYMENT_METHODS

# Pix avulso por QR continua disponível apenas como trilho técnico/fallback para
# cobranças pontuais; ele não é uma opção do checkout de novas assinaturas.
LEGACY_CHECKOUT_PAYMENT_METHODS = frozenset({"pix"})


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
            "Pix avulso não faz parte do checkout recorrente KÔMA. "
            "Use 'pix_automatic' para autorizar a recorrência."
        )


# Alias mantido para chamadas/testes antigos durante a transição.
def assert_no_upfront_subscription_payment(payment_method_type: str | None) -> None:
    assert_no_legacy_checkout_payment(payment_method_type)
