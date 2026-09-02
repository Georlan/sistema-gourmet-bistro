from __future__ import annotations

import json
import time
from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from app.crypt import encrypt_field
from app.services.online_payments.oauth import (
    MERCADO_PAGO_TOKEN_URL,
    MercadoPagoOAuthError,
    MercadoPagoOAuthStateError,
    _code_challenge,
    build_authorization_url,
    decode_state,
    exchange_authorization_code,
    refresh_access_token,
)


@pytest.fixture(autouse=True)
def oauth_env(monkeypatch):
    monkeypatch.setenv("MERCADO_PAGO_CLIENT_ID", "app-test-123")
    monkeypatch.setenv("MERCADO_PAGO_CLIENT_SECRET", "secret-test-456")
    monkeypatch.setenv(
        "MERCADO_PAGO_OAUTH_REDIRECT_URI",
        "https://api.example.test/payments/mercado-pago/oauth/callback",
    )
    monkeypatch.setenv("MERCADO_PAGO_OAUTH_STATE_TTL_SECONDS", "600")


def test_authorization_url_uses_marketplace_pkce_and_encrypted_state():
    url = build_authorization_url(restaurant_id=17, user_id="operator-9")
    parsed = urlparse(url)
    params = parse_qs(parsed.query)

    assert parsed.scheme == "https"
    assert parsed.netloc == "auth.mercadopago.com"
    assert params["response_type"] == ["code"]
    assert params["client_id"] == ["app-test-123"]
    assert params["platform_id"] == ["mp"]
    assert params["code_challenge_method"] == ["S256"]
    assert params["redirect_uri"] == [
        "https://api.example.test/payments/mercado-pago/oauth/callback"
    ]
    assert "client_secret" not in params
    assert "code_verifier" not in params

    state = params["state"][0]
    decoded = decode_state(state)
    assert decoded.restaurant_id == 17
    assert decoded.user_id == "operator-9"
    assert 43 <= len(decoded.code_verifier) <= 128
    assert params["code_challenge"] == [_code_challenge(decoded.code_verifier)]


def test_state_rejects_tampering_and_expiration(monkeypatch):
    url = build_authorization_url(restaurant_id=2, user_id="u-1")
    state = parse_qs(urlparse(url).query)["state"][0]

    with pytest.raises(MercadoPagoOAuthStateError):
        decode_state(f"{state[:-1]}x")

    expired = encrypt_field(
        json.dumps(
            {
                "v": 1,
                "rid": 2,
                "uid": "u-1",
                "verifier": "a" * 64,
                "iat": int(time.time()) - 601,
                "nonce": "nonce",
            }
        )
    )
    with pytest.raises(MercadoPagoOAuthStateError, match="expirado"):
        decode_state(expired)


def test_exchange_authorization_code_sends_pkce_verifier():
    authorization_url = build_authorization_url(
        restaurant_id=22,
        user_id="cashier-1",
    )
    state = parse_qs(urlparse(authorization_url).query)["state"][0]
    decoded = decode_state(state)
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == MERCADO_PAGO_TOKEN_URL
        captured.update(json.loads(request.content.decode("utf-8")))
        return httpx.Response(
            200,
            json={
                "access_token": "seller-access-token",
                "refresh_token": "seller-refresh-token",
                "public_key": "APP_USR-public",
                "user_id": 998877,
                "expires_in": 15552000,
            },
        )

    client = httpx.Client(transport=httpx.MockTransport(handler))
    try:
        returned_state, tokens = exchange_authorization_code(
            code="TG-test-code",
            state=state,
            client=client,
        )
    finally:
        client.close()

    assert returned_state.restaurant_id == 22
    assert captured == {
        "client_id": "app-test-123",
        "client_secret": "secret-test-456",
        "grant_type": "authorization_code",
        "code": "TG-test-code",
        "redirect_uri": "https://api.example.test/payments/mercado-pago/oauth/callback",
        "code_verifier": decoded.code_verifier,
    }
    assert tokens.access_token == "seller-access-token"
    assert tokens.refresh_token == "seller-refresh-token"
    assert tokens.provider_user_id == "998877"
    assert tokens.public_key == "APP_USR-public"
    assert tokens.expires_in == 15552000


def test_refresh_rotates_access_and_refresh_tokens():
    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content.decode("utf-8"))
        assert payload == {
            "client_id": "app-test-123",
            "client_secret": "secret-test-456",
            "grant_type": "refresh_token",
            "refresh_token": "old-refresh",
        }
        return httpx.Response(
            200,
            json={
                "access_token": "new-access",
                "refresh_token": "new-refresh",
                "user_id": "seller-42",
                "expires_in": 3600,
            },
        )

    client = httpx.Client(transport=httpx.MockTransport(handler))
    try:
        tokens = refresh_access_token("old-refresh", client=client)
    finally:
        client.close()

    assert tokens.access_token == "new-access"
    assert tokens.refresh_token == "new-refresh"
    assert tokens.provider_user_id == "seller-42"


def test_provider_errors_do_not_echo_sensitive_body():
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            400,
            json={"message": "bad", "access_token": "must-not-leak"},
        )

    client = httpx.Client(transport=httpx.MockTransport(handler))
    try:
        with pytest.raises(MercadoPagoOAuthError) as exc_info:
            refresh_access_token("refresh-value", client=client)
    finally:
        client.close()

    message = str(exc_info.value)
    assert "HTTP 400" in message
    assert "must-not-leak" not in message
