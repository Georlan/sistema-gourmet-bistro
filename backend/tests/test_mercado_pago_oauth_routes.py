from __future__ import annotations

from contextlib import contextmanager
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi import HTTPException

from app.models import Usuario
from app.routes import online_payments
from app.services.online_payments.oauth import (
    MercadoPagoOAuthState,
    MercadoPagoOAuthTokens,
)


class _FakeQuery:
    def __init__(self, value):
        self.value = value

    def filter(self, *_args, **_kwargs):
        return self

    def first(self):
        return self.value


class _FakeDb:
    def __init__(self, query_value=None):
        self.query_value = query_value
        self.commit_count = 0
        self.rollback_count = 0

    def query(self, _model):
        return _FakeQuery(self.query_value)

    def commit(self):
        self.commit_count += 1

    def rollback(self):
        self.rollback_count += 1


def _admin_user(*, restaurant_id=4, user_id="admin-1") -> Usuario:
    return Usuario(
        id=user_id,
        nome="Admin",
        cargo="admin",
        restaurante_id=restaurant_id,
        status="ativo",
    )


def test_connect_is_authenticated_tenant_scoped_and_returns_only_authorization_url(monkeypatch):
    captured = {}

    monkeypatch.setattr(online_payments, "require_tenant_id", lambda: 4)

    def fake_build(*, restaurant_id, user_id):
        captured.update(restaurant_id=restaurant_id, user_id=user_id)
        return "https://auth.mercadopago.com/authorization?safe=1"

    monkeypatch.setattr(online_payments, "build_authorization_url", fake_build)

    payload = online_payments.mercado_pago_connect(current_user=_admin_user())

    assert captured == {"restaurant_id": 4, "user_id": "admin-1"}
    assert payload == {
        "authorization_url": "https://auth.mercadopago.com/authorization?safe=1"
    }
    assert set(payload) == {"authorization_url"}


def test_callback_persists_only_inside_state_tenant_and_redirects(monkeypatch):
    initiator = _admin_user(restaurant_id=12, user_id="admin-12")
    db = _FakeDb(query_value=initiator)
    captured = {}

    oauth_state = MercadoPagoOAuthState(
        restaurant_id=12,
        user_id="admin-12",
        code_verifier="v" * 64,
        issued_at=1,
    )
    tokens = MercadoPagoOAuthTokens(
        access_token="access-secret",
        refresh_token="refresh-secret",
        public_key="public-key",
        provider_user_id="seller-12",
        expires_in=3600,
    )

    monkeypatch.setattr(
        online_payments,
        "exchange_authorization_code",
        lambda **_kwargs: (oauth_state, tokens),
    )

    @contextmanager
    def fake_scope(_db, restaurant_id):
        captured["scope_restaurant_id"] = restaurant_id
        yield restaurant_id

    monkeypatch.setattr(online_payments, "tenant_session_scope", fake_scope)

    def fake_upsert(_db, *, restaurant_id, tokens):
        captured["upsert_restaurant_id"] = restaurant_id
        captured["provider_user_id"] = tokens.provider_user_id
        return SimpleNamespace(id="account-12")

    monkeypatch.setattr(online_payments, "upsert_mercado_pago_account", fake_upsert)

    response = online_payments.mercado_pago_oauth_callback(
        code="TG-code",
        state="encrypted-state",
        db=db,
    )

    assert db.commit_count == 1
    assert captured == {
        "scope_restaurant_id": 12,
        "upsert_restaurant_id": 12,
        "provider_user_id": "seller-12",
    }
    assert response.status_code == 303
    location = response.headers["location"]
    params = parse_qs(urlparse(location).query)
    assert params["mercado_pago"] == ["connected"]
    assert "access-secret" not in location
    assert "refresh-secret" not in location


def test_callback_refuses_state_initiator_that_no_longer_exists(monkeypatch):
    db = _FakeDb(query_value=None)
    oauth_state = MercadoPagoOAuthState(
        restaurant_id=15,
        user_id="removed-user",
        code_verifier="v" * 64,
        issued_at=1,
    )
    tokens = MercadoPagoOAuthTokens(
        access_token="access",
        refresh_token="refresh",
        public_key=None,
        provider_user_id="seller-15",
        expires_in=None,
    )

    monkeypatch.setattr(
        online_payments,
        "exchange_authorization_code",
        lambda **_kwargs: (oauth_state, tokens),
    )

    @contextmanager
    def fake_scope(_db, restaurant_id):
        yield restaurant_id

    monkeypatch.setattr(online_payments, "tenant_session_scope", fake_scope)

    with pytest.raises(HTTPException) as exc_info:
        online_payments.mercado_pago_oauth_callback(
            code="TG-code",
            state="encrypted-state",
            db=db,
        )

    assert exc_info.value.status_code == 403
    assert db.commit_count == 0


def test_callback_cancellation_does_not_touch_database():
    db = _FakeDb()
    response = online_payments.mercado_pago_oauth_callback(
        error="access_denied",
        db=db,
    )

    assert response.status_code == 303
    assert db.commit_count == 0
    assert "mercado_pago=cancelled" in response.headers["location"]
