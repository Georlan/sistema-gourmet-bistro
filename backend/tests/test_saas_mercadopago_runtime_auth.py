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


def test_legacy_oauth_fallback_rejects_wrong_saas_application_before_token_request(monkeypatch):
    _configure_identity(monkeypatch)
    monkeypatch.setenv("KOMA_SAAS_MERCADO_PAGO_EXPECTED_APPLICATION_ID", "987654321")
    monkeypatch.setattr(
        runtime_auth, "_mint_client_credentials_token",
        lambda **_kwargs: pytest.fail("Não solicitar token da aplicação errada."),
    )

    with pytest.raises(SaasMercadoPagoError, match="não corresponde") as exc:
        runtime_auth.resolve_saas_access_token(_service())
    assert runtime_auth.runtime_auth_reason(exc.value) == "configured_application_mismatch"


def test_legacy_runtime_token_must_match_expected_collector(monkeypatch):
    _configure_identity(monkeypatch)
    monkeypatch.setenv("KOMA_SAAS_MERCADO_PAGO_EXPECTED_COLLECTOR_ID", "another-owner")
    monkeypatch.setattr(runtime_auth, "_mint_client_credentials_token", lambda **_kwargs: _valid_payload())
    with pytest.raises(SaasMercadoPagoError, match="conta recebedora diferente") as exc:
        runtime_auth.resolve_saas_access_token(_service())
    assert runtime_auth.runtime_auth_reason(exc.value) == "token_collector_mismatch"


def test_dedicated_saas_credentials_are_used_instead_of_restaurant_oauth(monkeypatch):
    _configure_identity(monkeypatch)
    monkeypatch.setenv("KOMA_SAAS_MERCADO_PAGO_CLIENT_ID", "987654321")
    monkeypatch.setenv("KOMA_SAAS_MERCADO_PAGO_CLIENT_SECRET", "saas-only-test-secret")
    monkeypatch.setenv("KOMA_SAAS_MERCADO_PAGO_EXPECTED_APPLICATION_ID", "987654321")
    monkeypatch.setenv("KOMA_SAAS_MERCADO_PAGO_EXPECTED_COLLECTOR_ID", "99887766")
    calls = []

    def mint(**credentials):
        calls.append(credentials)
        return _valid_payload(access_token="APP_USR-987654321-091512-abcdef-99887766")

    monkeypatch.setattr(runtime_auth, "_mint_client_credentials_token", mint)
    assert runtime_auth.resolve_saas_access_token(_service()).startswith("APP_USR-987654321-")
    assert calls == [{"client_id": "987654321", "client_secret": "saas-only-test-secret"}]


@pytest.mark.parametrize("missing", ["id", "secret"])
def test_partial_dedicated_credentials_fail_closed(monkeypatch, missing):
    _configure_identity(monkeypatch)
    monkeypatch.setenv("KOMA_SAAS_MERCADO_PAGO_CLIENT_ID", "987654321")
    monkeypatch.setenv("KOMA_SAAS_MERCADO_PAGO_CLIENT_SECRET", "saas-only-test-secret")
    monkeypatch.setenv("KOMA_SAAS_MERCADO_PAGO_EXPECTED_APPLICATION_ID", "987654321")
    key = "KOMA_SAAS_MERCADO_PAGO_CLIENT_ID" if missing == "id" else "KOMA_SAAS_MERCADO_PAGO_CLIENT_SECRET"
    monkeypatch.delenv(key)
    with pytest.raises(SaasMercadoPagoError, match="par completo") as exc:
        runtime_auth.resolve_saas_access_token(_service())
    assert runtime_auth.runtime_auth_reason(exc.value) == "missing_saas_client_credentials"


def test_dedicated_saas_token_rejects_another_collector(monkeypatch):
    _configure_identity(monkeypatch)
    monkeypatch.setenv("KOMA_SAAS_MERCADO_PAGO_CLIENT_ID", "987654321")
    monkeypatch.setenv("KOMA_SAAS_MERCADO_PAGO_CLIENT_SECRET", "saas-only-test-secret")
    monkeypatch.setenv("KOMA_SAAS_MERCADO_PAGO_EXPECTED_APPLICATION_ID", "987654321")
    monkeypatch.setenv("KOMA_SAAS_MERCADO_PAGO_EXPECTED_COLLECTOR_ID", "main-merchant-user")
    monkeypatch.setattr(runtime_auth, "_mint_client_credentials_token", lambda **_: _valid_payload(access_token="APP_USR-987654321-091512-abcdef-99887766"))
    with pytest.raises(SaasMercadoPagoError, match="conta recebedora diferente") as exc:
        runtime_auth.resolve_saas_access_token(_service())
    assert runtime_auth.runtime_auth_reason(exc.value) == "token_collector_mismatch"


def test_dedicated_application_must_match_expected_saas_application(monkeypatch):
    _configure_identity(monkeypatch)
    monkeypatch.setenv("KOMA_SAAS_MERCADO_PAGO_CLIENT_ID", "987654321")
    monkeypatch.setenv("KOMA_SAAS_MERCADO_PAGO_CLIENT_SECRET", "saas-only-test-secret")
    with pytest.raises(SaasMercadoPagoError, match="não corresponde") as exc:
        runtime_auth.resolve_saas_access_token(_service())
    assert runtime_auth.runtime_auth_reason(exc.value) == "configured_application_mismatch"


def test_runtime_token_rejects_public_key_mismatch_when_provider_returns_it(monkeypatch):
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


def test_runtime_token_accepts_response_without_public_key(monkeypatch):
    _configure_identity(monkeypatch)
    monkeypatch.setattr(
        runtime_auth,
        "_mint_client_credentials_token",
        lambda **_kwargs: _valid_payload(public_key=""),
    )

    assert runtime_auth.resolve_saas_access_token(_service()) == (
        "APP_USR-123456789-091512-abcdef-99887766"
    )


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


def test_checkout_disables_both_card_and_pix_when_static_identity_is_wrong(monkeypatch):
    from app import services as registry

    monkeypatch.setenv("KOMA_SAAS_MP_RUNTIME_TOKEN_ENABLED", "false")
    monkeypatch.setattr(
        registry, "_original_checkout_capabilities",
        lambda: {"credit_card": True, "pix": True, "account_money": False},
    )

    def raise_wrong_app():
        raise SaasMercadoPagoError("Aplicação incorreta", status_code=409)

    monkeypatch.setattr(
        registry, "_hosted_saas_mp_service",
        SimpleNamespace(environment="production", _ensure_provider_ready=raise_wrong_app),
    )

    caps = registry._runtime_auth_aware_checkout_capabilities()
    assert caps["credit_card"] is False
    assert caps["providerAuthReady"] is False
    assert caps["providerAuthReason"] == "provider_identity_not_ready"


def test_provider_oauth_error_is_reduced_to_safe_reason():
    class FakeResponse:
        status_code = 400

        @staticmethod
        def json():
            return {"error": "invalid_client", "message": "sensitive provider detail"}

    assert runtime_auth._safe_provider_error_code(FakeResponse()) == "oauth_invalid_client"
