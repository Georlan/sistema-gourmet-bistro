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
    # Esses IDs auxiliares podem ficar desatualizados sem derrubar uma
    # credencial que prove pertencer à aplicação pela Public Key oficial.
    monkeypatch.setenv("KOMA_SAAS_MERCADO_PAGO_EXPECTED_APPLICATION_ID", "old-app-id")
    monkeypatch.setenv("KOMA_SAAS_MERCADO_PAGO_EXPECTED_COLLECTOR_ID", "old-user-id")
    monkeypatch.setattr(settings, "KOMA_SAAS_MERCADO_PAGO_PUBLIC_KEY", "APP_USR-public")


def _valid_payload(**overrides):
    payload = {
        "access_token": "APP_USR-123456789-091512-abcdef-99887766",
        "user_id": 99887766,
        "public_key": "APP_USR-public",
        "expires_in": 21600,
        "live_mode": True,
    }
    payload.update(overrides)
    return payload


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
        return _valid_payload()

    monkeypatch.setattr(runtime_auth, "_mint_client_credentials_token", mint)

    service = _service()
    first = runtime_auth.resolve_saas_access_token(service)
    second = runtime_auth.resolve_saas_access_token(service)

    assert first == "APP_USR-123456789-091512-abcdef-99887766"
    assert second == first
    assert calls == [{"client_id": "123456789", "client_secret": "client-secret"}]


def test_stale_expected_application_and_collector_do_not_block_valid_application(monkeypatch):
    _configure_identity(monkeypatch)
    monkeypatch.setattr(runtime_auth, "_mint_client_credentials_token", lambda **_kwargs: _valid_payload())

    assert runtime_auth.resolve_saas_access_token(_service()).startswith("APP_USR-123456789-")


def test_runtime_token_requires_public_key_binding(monkeypatch):
    _configure_identity(monkeypatch)
    monkeypatch.setattr(
        runtime_auth,
        "_mint_client_credentials_token",
        lambda **_kwargs: _valid_payload(public_key="APP_USR-another-public-key"),
    )

    with pytest.raises(SaasMercadoPagoError, match="aplicação Mercado Pago diferente") as exc_info:
        runtime_auth.resolve_saas_access_token(_service())

    assert runtime_auth.runtime_auth_reason(exc_info.value) == "public_key_mismatch"
    assert runtime_auth.public_runtime_auth_reason(exc_info.value) == "provider_identity_not_ready"


def test_runtime_token_rejects_embedded_client_id_mismatch(monkeypatch):
    _configure_identity(monkeypatch)
    monkeypatch.setattr(
        runtime_auth,
        "_mint_client_credentials_token",
        lambda **_kwargs: _valid_payload(
            access_token="APP_USR-555555555-091512-abcdef-99887766"
        ),
    )

    with pytest.raises(SaasMercadoPagoError, match="Client ID") as exc_info:
        runtime_auth.resolve_saas_access_token(_service())

    assert runtime_auth.runtime_auth_reason(exc_info.value) == "token_client_id_mismatch"


def test_runtime_token_requires_returned_public_key(monkeypatch):
    _configure_identity(monkeypatch)
    monkeypatch.setattr(
        runtime_auth,
        "_mint_client_credentials_token",
        lambda **_kwargs: _valid_payload(public_key=""),
    )

    with pytest.raises(SaasMercadoPagoError, match="Public Key") as exc_info:
        runtime_auth.resolve_saas_access_token(_service())

    assert runtime_auth.runtime_auth_reason(exc_info.value) == "missing_returned_public_key"


def test_runtime_token_rejects_test_credential_in_production(monkeypatch):
    _configure_identity(monkeypatch)
    monkeypatch.setattr(
        runtime_auth,
        "_mint_client_credentials_token",
        lambda **_kwargs: _valid_payload(access_token="TEST-runtime-token", live_mode=False),
    )

    with pytest.raises(SaasMercadoPagoError, match="credencial de teste") as exc_info:
        runtime_auth.resolve_saas_access_token(_service())

    assert runtime_auth.runtime_auth_reason(exc_info.value) == "test_credential"


def test_runtime_token_requires_client_credentials(monkeypatch):
    _configure_identity(monkeypatch)
    monkeypatch.delenv("MERCADO_PAGO_CLIENT_SECRET")

    with pytest.raises(SaasMercadoPagoError, match="Client ID/Client Secret") as exc_info:
        runtime_auth.resolve_saas_access_token(_service())

    assert runtime_auth.runtime_auth_reason(exc_info.value) == "missing_client_credentials"
    assert runtime_auth.public_runtime_auth_reason(exc_info.value) == "provider_credentials_invalid"


def test_provider_oauth_error_is_reduced_to_safe_reason():
    class FakeResponse:
        status_code = 400

        @staticmethod
        def json():
            return {"error": "invalid_client", "message": "sensitive provider detail"}

    assert runtime_auth._safe_provider_error_code(FakeResponse()) == "oauth_invalid_client"
