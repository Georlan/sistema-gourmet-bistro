from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.config import settings
from app.services.saas_mercadopago import SaasMercadoPagoError
from app.services import saas_mercadopago_runtime_auth as runtime_auth


@pytest.fixture(autouse=True)
def clean_cache():
    runtime_auth.clear_runtime_token_cache()
    yield
    runtime_auth.clear_runtime_token_cache()


def _service(*, environment: str = "production", access_token: str = "APP_USR-stale"):
    return SimpleNamespace(
        environment=environment,
        access_token=access_token,
        API_URL="https://api.mercadopago.com",
    )


def _configure_identity(monkeypatch):
    monkeypatch.setenv("KOMA_SAAS_MP_RUNTIME_TOKEN_ENABLED", "true")
    monkeypatch.setenv("MERCADO_PAGO_CLIENT_ID", "123456789")
    monkeypatch.setenv("MERCADO_PAGO_CLIENT_SECRET", "client-secret")
    monkeypatch.setenv("KOMA_SAAS_MERCADO_PAGO_EXPECTED_APPLICATION_ID", "123456789")
    monkeypatch.setenv("KOMA_SAAS_MERCADO_PAGO_EXPECTED_COLLECTOR_ID", "99887766")
    monkeypatch.setattr(settings, "KOMA_SAAS_MERCADO_PAGO_PUBLIC_KEY", "APP_USR-public")


def test_runtime_token_disabled_preserves_static_access_token(monkeypatch):
    monkeypatch.delenv("KOMA_SAAS_MP_RUNTIME_TOKEN_ENABLED", raising=False)
    assert runtime_auth.resolve_saas_access_token(_service()) == "APP_USR-stale"


def test_runtime_token_never_crosses_into_homologation(monkeypatch):
    _configure_identity(monkeypatch)
    monkeypatch.setattr(
        runtime_auth,
        "_mint_client_credentials_token",
        lambda **_kwargs: pytest.fail("production OAuth must not run in homologation"),
    )
    assert runtime_auth.resolve_saas_access_token(
        _service(environment="homologation", access_token="TEST-sandbox")
    ) == "TEST-sandbox"


def test_runtime_token_uses_client_credentials_and_caches(monkeypatch):
    _configure_identity(monkeypatch)
    calls = []

    def mint(**kwargs):
        calls.append(kwargs)
        return {
            "access_token": "APP_USR-fresh-runtime-token",
            "user_id": 99887766,
            "public_key": "APP_USR-public",
            "expires_in": 21600,
        }

    monkeypatch.setattr(runtime_auth, "_mint_client_credentials_token", mint)

    service = _service()
    first = runtime_auth.resolve_saas_access_token(service)
    second = runtime_auth.resolve_saas_access_token(service)

    assert first == "APP_USR-fresh-runtime-token"
    assert second == first
    assert calls == [{"client_id": "123456789", "client_secret": "client-secret"}]


def test_runtime_token_fails_closed_when_client_id_is_not_expected_application(monkeypatch):
    _configure_identity(monkeypatch)
    monkeypatch.setenv("MERCADO_PAGO_CLIENT_ID", "different-app")

    with pytest.raises(SaasMercadoPagoError, match="não pertence à aplicação"):
        runtime_auth.resolve_saas_access_token(_service())


def test_runtime_token_fails_closed_when_provider_user_is_not_expected_collector(monkeypatch):
    _configure_identity(monkeypatch)
    monkeypatch.setattr(
        runtime_auth,
        "_mint_client_credentials_token",
        lambda **_kwargs: {
            "access_token": "APP_USR-other-account",
            "user_id": "111222333",
            "public_key": "APP_USR-public",
            "expires_in": 21600,
        },
    )

    with pytest.raises(SaasMercadoPagoError, match="conta Mercado Pago diferente"):
        runtime_auth.resolve_saas_access_token(_service())


def test_runtime_token_fails_closed_when_public_key_identifies_another_application(monkeypatch):
    _configure_identity(monkeypatch)
    monkeypatch.setattr(
        runtime_auth,
        "_mint_client_credentials_token",
        lambda **_kwargs: {
            "access_token": "APP_USR-other-app",
            "user_id": "99887766",
            "public_key": "APP_USR-another-public-key",
            "expires_in": 21600,
        },
    )

    with pytest.raises(SaasMercadoPagoError, match="aplicação Mercado Pago diferente"):
        runtime_auth.resolve_saas_access_token(_service())


def test_runtime_token_rejects_test_credential_in_production(monkeypatch):
    _configure_identity(monkeypatch)
    monkeypatch.setattr(
        runtime_auth,
        "_mint_client_credentials_token",
        lambda **_kwargs: {
            "access_token": "TEST-runtime-token",
            "user_id": "99887766",
            "expires_in": 21600,
        },
    )

    with pytest.raises(SaasMercadoPagoError, match="credencial de teste"):
        runtime_auth.resolve_saas_access_token(_service())
