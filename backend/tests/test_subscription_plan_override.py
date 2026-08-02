from app.config import settings
from app.subscription import (
    get_effective_subscription_plan,
    is_test_premium_restaurant,
    subscription_has_printing,
)


def test_override_premium_fica_desligado_por_padrao(monkeypatch):
    monkeypatch.setattr(settings, "KOMA_TEST_PREMIUM_RESTAURANTE_IDS", "")

    assert get_effective_subscription_plan(1, "pocket") == "pocket"
    assert is_test_premium_restaurant(1) is False
    assert subscription_has_printing(1, "pocket") is False


def test_override_premium_isola_restaurante_autorizado(monkeypatch):
    monkeypatch.setattr(
        settings,
        "KOMA_TEST_PREMIUM_RESTAURANTE_IDS",
        "2, 7",
    )

    assert get_effective_subscription_plan(2, "pocket") == "premium"
    assert get_effective_subscription_plan(7, "pro") == "premium"
    assert subscription_has_printing(2, "pocket") is True
    assert get_effective_subscription_plan(3, "pocket") == "pocket"
    assert is_test_premium_restaurant(3) is False


def test_planos_legados_sao_normalizados_sem_mudar_banco(monkeypatch):
    monkeypatch.setattr(settings, "KOMA_TEST_PREMIUM_RESTAURANTE_IDS", "")

    assert get_effective_subscription_plan(1, "bistro") == "premium"
    assert get_effective_subscription_plan(1, "desconhecido") == "pocket"
