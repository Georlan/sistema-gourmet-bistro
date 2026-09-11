from __future__ import annotations

import datetime
from types import SimpleNamespace

import pytest

from app.services.online_payments import service
from app.services.online_payments.base import ProviderPayment
from app.services.online_payments.mercado_pago import MercadoPagoError
from app.services.online_payments.oauth import MercadoPagoOAuthTokens


class _FakeQuery:
    def __init__(self, value):
        self.value = value

    def filter(self, *_args, **_kwargs):
        return self

    def with_for_update(self):
        return self

    def first(self):
        return self.value


class _RefreshSession:
    def __init__(self, account):
        self.account = account
        self.commits = 0
        self.rollbacks = 0
        self.closed = False

    def query(self, _model):
        return _FakeQuery(self.account)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1

    def close(self):
        self.closed = True


class _RequestSession:
    def __init__(self, source_account=None):
        self.source_account = source_account
        self.commits = 0
        self.refreshed = []

    def refresh(self, account):
        self.refreshed.append(account)
        if self.source_account is None:
            return
        for name in (
            "access_token",
            "refresh_token",
            "public_key",
            "provider_user_id",
            "token_expires_at",
            "updated_at",
        ):
            setattr(account, name, getattr(self.source_account, name, None))

    def commit(self):
        self.commits += 1


def _account(**overrides):
    payload = {
        "id": "account-1",
        "restaurante_id": 3,
        "provider": "mercado_pago",
        "provider_user_id": "seller-3",
        "status": "active",
        "access_token": "old-access",
        "refresh_token": "old-refresh",
        "webhook_secret": "webhook-secret",
        "public_key": "old-public",
        "token_expires_at": datetime.datetime.now(datetime.timezone.utc)
        - datetime.timedelta(minutes=1),
        "updated_at": None,
    }
    payload.update(overrides)
    return SimpleNamespace(**payload)


def _tokens(**overrides):
    payload = {
        "access_token": "new-access",
        "refresh_token": "new-refresh",
        "public_key": "new-public",
        "provider_user_id": "seller-3",
        "expires_in": 3600,
    }
    payload.update(overrides)
    return MercadoPagoOAuthTokens(**payload)


def test_refresh_account_commits_rotated_credentials_in_independent_session(monkeypatch):
    request_account = _account()
    persisted_account = _account()
    refresh_db = _RefreshSession(persisted_account)
    request_db = _RequestSession(source_account=persisted_account)
    refresh_calls = []

    monkeypatch.setattr(service, "SessionLocal", lambda **_kwargs: refresh_db)

    def fake_refresh(token):
        refresh_calls.append(token)
        return _tokens()

    monkeypatch.setattr(service, "refresh_access_token", fake_refresh)

    result = service.OnlinePaymentService._refresh_account_credentials(
        request_db,
        request_account,
    )

    assert result is request_account
    assert refresh_calls == ["old-refresh"]
    assert refresh_db.commits == 1
    assert refresh_db.closed is True
    assert persisted_account.access_token == "new-access"
    assert persisted_account.refresh_token == "new-refresh"
    assert persisted_account.public_key == "new-public"
    assert persisted_account.token_expires_at > datetime.datetime.now(datetime.timezone.utc)
    assert request_account.access_token == "new-access"
    assert request_account.refresh_token == "new-refresh"
    assert request_db.refreshed == [request_account]


def test_forced_refresh_reuses_credentials_if_another_request_already_rotated(monkeypatch):
    request_account = _account(access_token="stale-access")
    persisted_account = _account(
        access_token="already-refreshed",
        refresh_token="already-rotated",
        token_expires_at=datetime.datetime.now(datetime.timezone.utc)
        + datetime.timedelta(hours=1),
    )
    refresh_db = _RefreshSession(persisted_account)
    request_db = _RequestSession(source_account=persisted_account)

    monkeypatch.setattr(service, "SessionLocal", lambda **_kwargs: refresh_db)

    def should_not_refresh(_token):
        pytest.fail("refresh_access_token não deve ser chamado após outra requisição já renovar")

    monkeypatch.setattr(service, "refresh_access_token", should_not_refresh)

    service.OnlinePaymentService._refresh_account_credentials(
        request_db,
        request_account,
        force=True,
        known_access_token="stale-access",
    )

    assert refresh_db.commits == 0
    assert refresh_db.rollbacks >= 1
    assert request_account.access_token == "already-refreshed"
    assert request_account.refresh_token == "already-rotated"


def test_pix_creation_retries_once_after_provider_401(monkeypatch):
    account = _account(
        access_token="expired-access",
        token_expires_at=None,
    )
    intent = SimpleNamespace(
        id="intent-1",
        restaurante_id=3,
        amount=100.0,
        marketplace_fee=0.69,
        external_payment_id=None,
        qr_code=None,
        qr_code_base64=None,
        ticket_url=None,
        expires_at=None,
        last_error=None,
    )
    settled = SimpleNamespace(
        qr_code=None,
        qr_code_base64=None,
        ticket_url=None,
        expires_at=None,
        last_error="old-error",
    )
    calls = []

    class _Provider:
        def __init__(self, access_token):
            self.access_token = access_token

        def create_pix(self, **kwargs):
            calls.append((self.access_token, kwargs))
            if self.access_token == "expired-access":
                raise MercadoPagoError("expired", status_code=401)
            return ProviderPayment(
                external_id="12345",
                status="pending",
                amount=kwargs["amount"],
                external_reference=kwargs["external_reference"],
                qr_code="pix-copy-paste",
                qr_code_base64="pix-base64",
                ticket_url="https://example.invalid/pix",
                expires_at=kwargs["expires_at"],
            )

    class _Db(_RequestSession):
        def query(self, _model):
            raise AssertionError("query de erro não deve ocorrer no caminho de sucesso")

    db = _Db()

    monkeypatch.setattr(service, "MercadoPagoProvider", _Provider)

    def fake_refresh(db_arg, account_arg, **kwargs):
        assert db_arg is db
        assert kwargs["force"] is True
        assert kwargs["known_access_token"] == "expired-access"
        account_arg.access_token = "fresh-access"
        return account_arg

    monkeypatch.setattr(
        service.OnlinePaymentService,
        "_refresh_account_credentials",
        staticmethod(fake_refresh),
    )
    monkeypatch.setattr(
        service.OnlinePaymentService,
        "apply_provider_snapshot_in_session",
        classmethod(lambda cls, db, account, intent, payment: (settled, False)),
    )

    result = service.OnlinePaymentService.ensure_pix_created(
        db,
        intent=intent,
        payer_email="cliente@example.com",
        account=account,
    )

    assert result is settled
    assert [token for token, _ in calls] == ["expired-access", "fresh-access"]
    assert calls[0][1]["idempotency_key"] == calls[1][1]["idempotency_key"]
    assert settled.qr_code == "pix-copy-paste"
    assert settled.last_error is None
    assert db.commits == 1
