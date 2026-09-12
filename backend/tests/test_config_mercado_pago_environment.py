import pytest

from app.config import resolve_saas_mercado_pago_credentials


_ALL_MP_ENV_VARS = (
    "KOMA_SAAS_MERCADO_PAGO_ACCESS_TOKEN",
    "KOMA_SAAS_MP_ACCESS_TOKEN",
    "KOMA_SAAS_MERCADO_PAGO_PUBLIC_KEY",
    "KOMA_SAAS_MP_PUBLIC_KEY",
    "KOMA_SAAS_MERCADO_PAGO_WEBHOOK_SECRET",
    "KOMA_SAAS_MP_WEBHOOK_SECRET",
    "KOMA_SAAS_MERCADO_PAGO_TEST_ACCESS_TOKEN",
    "KOMA_SAAS_MERCADO_PAGO_TEST_PUBLIC_KEY",
    "KOMA_SAAS_MERCADO_PAGO_TEST_WEBHOOK_SECRET",
)


@pytest.fixture(autouse=True)
def clean_mp_environment(monkeypatch):
    for name in _ALL_MP_ENV_VARS:
        monkeypatch.delenv(name, raising=False)


def test_homologation_never_falls_back_to_production_credentials(monkeypatch):
    monkeypatch.setenv("KOMA_SAAS_MERCADO_PAGO_ACCESS_TOKEN", "APP_USR-production")
    monkeypatch.setenv("KOMA_SAAS_MERCADO_PAGO_PUBLIC_KEY", "APP_USR-production-public")
    monkeypatch.setenv("KOMA_SAAS_MERCADO_PAGO_WEBHOOK_SECRET", "production-secret")

    assert resolve_saas_mercado_pago_credentials("homologation") == ("", "", "")


def test_homologation_accepts_only_explicit_test_credentials(monkeypatch):
    monkeypatch.setenv("KOMA_SAAS_MERCADO_PAGO_TEST_ACCESS_TOKEN", "TEST-token")
    monkeypatch.setenv("KOMA_SAAS_MERCADO_PAGO_TEST_PUBLIC_KEY", "TEST-public")
    monkeypatch.setenv("KOMA_SAAS_MERCADO_PAGO_TEST_WEBHOOK_SECRET", "test-secret")

    assert resolve_saas_mercado_pago_credentials("homologation") == (
        "TEST-token",
        "TEST-public",
        "test-secret",
    )


def test_homologation_rejects_a_production_token_in_test_slot(monkeypatch):
    monkeypatch.setenv("KOMA_SAAS_MERCADO_PAGO_TEST_ACCESS_TOKEN", "APP_USR-wrong")

    with pytest.raises(RuntimeError, match="prefixo TEST-"):
        resolve_saas_mercado_pago_credentials("homologation")


def test_production_rejects_test_credentials(monkeypatch):
    monkeypatch.setenv("KOMA_SAAS_MERCADO_PAGO_ACCESS_TOKEN", "TEST-wrong")

    with pytest.raises(RuntimeError, match="proibidas em ambiente de produção"):
        resolve_saas_mercado_pago_credentials("production")
