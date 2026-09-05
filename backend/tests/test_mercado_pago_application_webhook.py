from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import BackgroundTasks, HTTPException

from app.routes import online_payments


class _FakeRequest:
    def __init__(self, payload):
        self._payload = payload
        self.query_params = {}
        self.headers = {}

    async def json(self):
        return self._payload


class _FakeScalarResult:
    def __init__(self, value):
        self.value = value

    def scalar_one_or_none(self):
        return self.value


class _FakeResolverDb:
    def __init__(self, *, dialect_name: str, result: str | None):
        self.bind = SimpleNamespace(dialect=SimpleNamespace(name=dialect_name))
        self.result = result
        self.calls: list[tuple[str, dict[str, str]]] = []

    def get_bind(self):
        return self.bind

    def execute(self, statement, params):
        self.calls.append((str(statement), params))
        return _FakeScalarResult(self.result)


def test_application_webhook_routes_by_seller_user_id(monkeypatch):
    db = object()
    request = _FakeRequest(
        {
            "type": "payment",
            "user_id": 724484980,
            "data": {"id": "123456"},
        }
    )
    background_tasks = BackgroundTasks()
    captured = {}

    def fake_resolve(_db, provider_user_id):
        captured["provider_user_id"] = provider_user_id
        return "account-724484980"

    async def fake_webhook(*, account_id, request, background_tasks, db):
        captured.update(
            account_id=account_id,
            request=request,
            background_tasks=background_tasks,
            db=db,
        )
        return {"status": "processed"}

    monkeypatch.setattr(
        online_payments,
        "_resolve_mercado_pago_account_id",
        fake_resolve,
    )
    monkeypatch.setattr(online_payments, "mercado_pago_webhook", fake_webhook)

    result = asyncio.run(
        online_payments.mercado_pago_application_webhook(
            request=request,
            background_tasks=background_tasks,
            db=db,
        )
    )

    assert result == {"status": "processed"}
    assert captured["provider_user_id"] == "724484980"
    assert captured["account_id"] == "account-724484980"
    assert captured["request"] is request
    assert captured["background_tasks"] is background_tasks
    assert captured["db"] is db


def test_application_webhook_fails_closed_for_unknown_seller(monkeypatch):
    request = _FakeRequest(
        {
            "type": "payment",
            "user_id": "seller-not-connected",
            "data": {"id": "123456"},
        }
    )

    monkeypatch.setattr(
        online_payments,
        "_resolve_mercado_pago_account_id",
        lambda _db, _provider_user_id: None,
    )
    fallback_called = False

    def fail_if_fallback(_db, _payment_id):
        nonlocal fallback_called
        fallback_called = True
        return "should-not-route"

    monkeypatch.setattr(
        online_payments,
        "_resolve_mercado_pago_account_id_by_payment",
        fail_if_fallback,
    )

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            online_payments.mercado_pago_application_webhook(
                request=request,
                background_tasks=BackgroundTasks(),
                db=object(),
            )
        )

    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == "Assinatura de pagamento inválida."
    assert fallback_called is False


def test_application_webhook_routes_by_known_payment_when_user_id_is_absent(monkeypatch):
    db = object()
    request = _FakeRequest(
        {
            "type": "payment",
            "data": {"id": "123456"},
        }
    )
    background_tasks = BackgroundTasks()
    captured = {}

    def fake_payment_resolve(_db, payment_id):
        captured["payment_id"] = payment_id
        return "account-by-payment"

    async def fake_webhook(*, account_id, request, background_tasks, db):
        captured.update(
            account_id=account_id,
            request=request,
            background_tasks=background_tasks,
            db=db,
        )
        return {"status": "processed"}

    monkeypatch.setattr(
        online_payments,
        "_resolve_mercado_pago_account_id_by_payment",
        fake_payment_resolve,
    )
    monkeypatch.setattr(online_payments, "mercado_pago_webhook", fake_webhook)

    result = asyncio.run(
        online_payments.mercado_pago_application_webhook(
            request=request,
            background_tasks=background_tasks,
            db=db,
        )
    )

    assert result == {"status": "processed"}
    assert captured["payment_id"] == "123456"
    assert captured["account_id"] == "account-by-payment"


def test_application_webhook_fails_closed_for_unknown_payment_without_user_id(monkeypatch):
    monkeypatch.setattr(
        online_payments,
        "_resolve_mercado_pago_account_id_by_payment",
        lambda _db, _payment_id: None,
    )

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            online_payments.mercado_pago_application_webhook(
                request=_FakeRequest({"type": "payment", "data": {"id": "123"}}),
                background_tasks=BackgroundTasks(),
                db=object(),
            )
        )

    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == "Assinatura de pagamento inválida."


@pytest.mark.parametrize(
    "payload",
    [
        None,
        {},
        {"type": "claim", "user_id": "seller-1", "data": {"id": "123"}},
        {"type": "payment", "user_id": "seller-1", "data": {}},
    ],
)
def test_application_webhook_rejects_non_payment_or_missing_payment(payload):
    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            online_payments.mercado_pago_application_webhook(
                request=_FakeRequest(payload),
                background_tasks=BackgroundTasks(),
                db=object(),
            )
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Notificação de pagamento inválida."


def test_postgres_seller_resolver_calls_only_security_definer_function():
    db = _FakeResolverDb(dialect_name="postgresql", result="account-42")

    result = online_payments._resolve_mercado_pago_account_id(db, " seller-42 ")

    assert result == "account-42"
    assert len(db.calls) == 1
    statement, params = db.calls[0]
    assert "koma_internal.resolve_mercado_pago_account_id" in statement
    assert "restaurant_payment_accounts" not in statement
    assert params == {"provider_user_id": "seller-42"}


def test_sqlite_seller_resolver_is_provider_and_status_scoped():
    db = _FakeResolverDb(dialect_name="sqlite", result="account-local")

    result = online_payments._resolve_mercado_pago_account_id(db, "seller-local")

    assert result == "account-local"
    statement, params = db.calls[0]
    assert "provider = 'mercado_pago'" in statement
    assert "provider_user_id = :provider_user_id" in statement
    assert "status = 'active'" in statement
    assert params == {"provider_user_id": "seller-local"}


def test_postgres_payment_resolver_calls_only_security_definer_function():
    db = _FakeResolverDb(dialect_name="postgresql", result="account-payment")

    result = online_payments._resolve_mercado_pago_account_id_by_payment(db, " 123456 ")

    assert result == "account-payment"
    assert len(db.calls) == 1
    statement, params = db.calls[0]
    assert "koma_internal.resolve_mercado_pago_account_id_by_payment" in statement
    assert "online_payment_intents" not in statement
    assert params == {"payment_id": "123456"}


def test_sqlite_payment_resolver_is_provider_and_status_scoped():
    db = _FakeResolverDb(dialect_name="sqlite", result="account-payment-local")

    result = online_payments._resolve_mercado_pago_account_id_by_payment(db, "123456")

    assert result == "account-payment-local"
    statement, params = db.calls[0]
    assert "online_payment_intents" in statement
    assert "restaurant_payment_accounts" in statement
    assert "a.provider = 'mercado_pago'" in statement
    assert "a.status = 'active'" in statement
    assert "i.external_payment_id = :payment_id" in statement
    assert params == {"payment_id": "123456"}


def test_webhook_resolver_migration_is_rls_safe_and_additive():
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "1c2d3e4f5a6b_resolve_mercado_pago_webhook_account.py"
    )
    source = migration_path.read_text(encoding="utf-8")

    assert 'down_revision = "0a1b2c3d4e5f"' in source
    assert "SECURITY DEFINER" in source
    assert "pg_has_role(session_user, 'koma_app', 'member')" in source
    assert "a.provider = 'mercado_pago'" in source
    assert "a.provider_user_id" in source
    assert "a.status = 'active'" in source
    assert "REVOKE ALL ON FUNCTION" in source
    assert "GRANT EXECUTE ON FUNCTION" in source
    assert "ALTER TABLE" not in source


def test_payment_resolver_migration_is_rls_safe():
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "b7e5a2c91d44_add_online_payment_refunds.py"
    )
    source = migration_path.read_text(encoding="utf-8")

    assert 'down_revision = "dc8dcc280fff"' in source
    assert "resolve_mercado_pago_account_id_by_payment" in source
    assert "SECURITY DEFINER" in source
    assert "pg_has_role(session_user, 'koma_app', 'member')" in source
    assert "i.external_payment_id" in source
    assert "a.provider = 'mercado_pago'" in source
    assert "a.status = 'active'" in source
    assert "REVOKE ALL ON FUNCTION" in source
    assert "GRANT EXECUTE ON FUNCTION" in source
