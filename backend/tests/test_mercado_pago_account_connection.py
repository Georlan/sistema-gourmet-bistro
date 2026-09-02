from __future__ import annotations

import datetime

from app.models import RestaurantPaymentAccount
from app.services.online_payments.account_connection import (
    payment_account_status,
    upsert_mercado_pago_account,
)
from app.services.online_payments.oauth import MercadoPagoOAuthTokens


class _FakeQuery:
    def __init__(self, value):
        self.value = value

    def filter(self, *_args, **_kwargs):
        return self

    def first(self):
        return self.value


class _FakeSession:
    def __init__(self, existing=None):
        self.existing = existing
        self.added = []
        self.flush_count = 0

    def query(self, _model):
        return _FakeQuery(self.existing)

    def add(self, value):
        self.added.append(value)

    def flush(self):
        self.flush_count += 1


def _tokens(**overrides):
    payload = {
        "access_token": "seller-access",
        "refresh_token": "seller-refresh",
        "public_key": "APP_USR-public",
        "provider_user_id": "seller-123",
        "expires_in": 3600,
    }
    payload.update(overrides)
    return MercadoPagoOAuthTokens(**payload)


def test_creates_active_account_without_committing():
    db = _FakeSession()

    account = upsert_mercado_pago_account(
        db,
        restaurant_id=7,
        tokens=_tokens(),
        webhook_secret="webhook-secret",
    )

    assert account in db.added
    assert db.flush_count == 1
    assert account.restaurante_id == 7
    assert account.provider == "mercado_pago"
    assert account.provider_user_id == "seller-123"
    assert account.status == "active"
    assert account.access_token == "seller-access"
    assert account.refresh_token == "seller-refresh"
    assert account.webhook_secret == "webhook-secret"
    assert account.public_key == "APP_USR-public"
    assert account.token_expires_at is not None
    assert account.token_expires_at > datetime.datetime.now(datetime.timezone.utc)


def test_reconnect_updates_existing_account_and_preserves_rotating_optional_values():
    existing = RestaurantPaymentAccount(
        id="account-existing",
        restaurante_id=8,
        provider="mercado_pago",
        provider_user_id="seller-old",
        status="disconnected",
        public_key="old-public",
    )
    existing.access_token = "old-access"
    existing.refresh_token = "old-refresh"
    existing.webhook_secret = "old-webhook"

    db = _FakeSession(existing=existing)
    account = upsert_mercado_pago_account(
        db,
        restaurant_id=8,
        tokens=_tokens(
            access_token="new-access",
            refresh_token=None,
            public_key=None,
            provider_user_id="seller-new",
            expires_in=None,
        ),
        webhook_secret="new-webhook",
    )

    assert account is existing
    assert db.added == []
    assert db.flush_count == 1
    assert account.status == "active"
    assert account.provider_user_id == "seller-new"
    assert account.access_token == "new-access"
    assert account.refresh_token == "old-refresh"
    assert account.webhook_secret == "new-webhook"
    assert account.public_key == "old-public"
    assert account.token_expires_at is None


def test_status_never_exposes_tokens_or_webhook_secret():
    disconnected = payment_account_status(None)
    assert disconnected == {
        "provider": "mercado_pago",
        "connected": False,
        "status": "disconnected",
        "provider_user_id": None,
        "token_expires_at": None,
    }

    account = RestaurantPaymentAccount(
        id="safe-status",
        restaurante_id=9,
        provider="mercado_pago",
        provider_user_id="seller-safe",
        status="active",
    )
    account.access_token = "do-not-expose"
    account.webhook_secret = "also-secret"

    status = payment_account_status(account)
    assert status["connected"] is True
    assert status["provider_user_id"] == "seller-safe"
    assert "access_token" not in status
    assert "refresh_token" not in status
    assert "webhook_secret" not in status
