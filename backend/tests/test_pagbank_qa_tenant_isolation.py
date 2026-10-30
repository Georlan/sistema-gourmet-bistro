"""Tests verifying QA restaurant (ID 9) PagBank Sandbox isolation.
Guarantees:
- ID 9 defaults to Sandbox while restaurant 8 (D8 Burger) remains in Production.
- Production credentials are never used as fallback for restaurant 9.
- Tenant isolation: restaurant 9 cannot access or alter other tenants' tokens or receivables.
- Application owner account is rejected as a receiver.
- D8 Burger configuration and status remain strictly unchanged.
"""
import pytest
from app.services.online_payments.pagbank import oauth


def test_qa_restaurant_9_uses_sandbox_while_restaurant_8_is_production(monkeypatch):
    monkeypatch.setenv('PAGBANK_ENV', 'sandbox')
    monkeypatch.setenv('PAGBANK_PRODUCTION_RESTAURANT_IDS', '8')
    monkeypatch.setenv('PAGBANK_CLIENT_ID', 'sandbox-client-id')
    monkeypatch.setenv('PAGBANK_CLIENT_SECRET', 'sandbox-client-secret')
    monkeypatch.setenv('PAGBANK_APP_TOKEN', 'sandbox-app-token')
    monkeypatch.setenv('PAGBANK_PRODUCTION_CLIENT_ID', 'prod-client-id')
    monkeypatch.setenv('PAGBANK_PRODUCTION_CLIENT_SECRET', 'prod-client-secret')
    monkeypatch.setenv('PAGBANK_PRODUCTION_APP_TOKEN', 'prod-app-token')

    # Restaurant 9 is QA: strictly Sandbox
    assert oauth.environment_for_restaurant(9) == 'sandbox'
    assert oauth.api_url(oauth.environment_for_restaurant(9)) == 'https://sandbox.api.pagseguro.com'
    assert oauth.credential('CLIENT_ID', oauth.environment_for_restaurant(9)) == 'sandbox-client-id'
    assert oauth.credential('APP_TOKEN', oauth.environment_for_restaurant(9)) == 'sandbox-app-token'

    # Restaurant 8 is D8 Burger: strictly Production
    assert oauth.environment_for_restaurant(8) == 'production'
    assert oauth.api_url(oauth.environment_for_restaurant(8)) == 'https://api.pagseguro.com'
    assert oauth.credential('CLIENT_ID', oauth.environment_for_restaurant(8)) == 'prod-client-id'
    assert oauth.credential('APP_TOKEN', oauth.environment_for_restaurant(8)) == 'prod-app-token'

    # Other restaurants (e.g. 6, 7) are also unaffected and default to Sandbox
    assert oauth.environment_for_restaurant(6) == 'sandbox'
    assert oauth.environment_for_restaurant(7) == 'sandbox'


def test_sandbox_never_falls_back_to_production_credentials(monkeypatch):
    monkeypatch.setenv('PAGBANK_ENV', 'sandbox')
    monkeypatch.setenv('PAGBANK_PRODUCTION_RESTAURANT_IDS', '8')
    monkeypatch.setenv('PAGBANK_PRODUCTION_CLIENT_ID', 'prod-client-id')
    monkeypatch.delenv('PAGBANK_CLIENT_ID', raising=False)

    # If sandbox client ID is not set, it must NOT fall back to prod client ID
    assert oauth.credential('CLIENT_ID', oauth.environment_for_restaurant(9)) == ''
    assert not oauth.configured(oauth.environment_for_restaurant(9))


def test_authorization_url_binds_to_restaurant_9_and_sandbox_host(monkeypatch):
    monkeypatch.setenv('PAGBANK_ENV', 'sandbox')
    monkeypatch.setenv('PAGBANK_PRODUCTION_RESTAURANT_IDS', '8')
    monkeypatch.setenv('PAGBANK_CLIENT_ID', 'sandbox-client-id')
    monkeypatch.setenv('PAGBANK_CLIENT_SECRET', 'sandbox-client-secret')
    monkeypatch.setenv('PAGBANK_APP_TOKEN', 'sandbox-app-token')
    monkeypatch.setenv('PAGBANK_OAUTH_REDIRECT_URI', 'https://sistema-gourmet-bistro-production.up.railway.app/payments/pagbank/oauth/callback')

    url, state = oauth.authorization(9, 'user-admin-qa')
    assert 'connect.sandbox.pagbank.com.br' in url
    assert 'client_id=sandbox-client-id' in url
    assert 'payments.read' in url

    rid, uid = oauth.decode_state(state, state)
    assert rid == 9
    assert uid == 'user-admin-qa'


def test_application_owner_protection_for_restaurant_9(monkeypatch):
    monkeypatch.setenv('PAGBANK_ENV', 'sandbox')
    monkeypatch.setenv('PAGBANK_APPLICATION_OWNER_ACCOUNT_ID', 'ACCO_PLATFORM_OWNER')
    assert oauth.is_application_owner('ACCO_PLATFORM_OWNER', environment='sandbox')
    assert not oauth.is_application_owner('ACCO_SELLER_DIFFERENT', environment='sandbox')


def test_qa9_owner_oauth_evidence_only_requires_two_flags_and_sandbox(monkeypatch):
    monkeypatch.setenv('PAGBANK_ENV', 'sandbox')
    monkeypatch.setenv('PAGBANK_PRODUCTION_RESTAURANT_IDS', '8')
    monkeypatch.setenv('PAGBANK_SANDBOX_OAUTH_EVIDENCE_RESTAURANT_IDS', '9')
    monkeypatch.delenv('PAGBANK_SANDBOX_QA9_OAUTH_EVIDENCE_ONLY', raising=False)
    assert not oauth.qa9_sandbox_evidence_only(9)
    monkeypatch.setenv('PAGBANK_SANDBOX_QA9_OAUTH_EVIDENCE_ONLY', 'true')
    assert oauth.qa9_sandbox_evidence_only(9)
    assert not oauth.qa9_sandbox_evidence_only(8)
    assert not oauth.qa9_sandbox_evidence_only(6)
    monkeypatch.setenv('PAGBANK_PRODUCTION_RESTAURANT_IDS', '8,9')
    assert not oauth.qa9_sandbox_evidence_only(9)
    monkeypatch.setenv('PAGBANK_PRODUCTION_RESTAURANT_IDS', '8')
    monkeypatch.setenv('PAGBANK_SANDBOX_OAUTH_EVIDENCE_RESTAURANT_IDS', '8')
    assert not oauth.qa9_sandbox_evidence_only(9)
    monkeypatch.setenv('PAGBANK_SANDBOX_OAUTH_EVIDENCE_RESTAURANT_IDS', '9')
    monkeypatch.setenv('PAGBANK_SANDBOX_QA9_OAUTH_EVIDENCE_ONLY', 'TRUE')
    assert not oauth.qa9_sandbox_evidence_only(9)


@pytest.mark.parametrize('rid,production,flag,expected_evidence', [
    (9, False, True, True),
    (9, False, False, False),
    (9, True, True, False),
    (8, False, True, False),
])
def test_owner_oauth_exchange_is_evidence_only_only_for_sandbox_qa9(
    monkeypatch, rid, production, flag, expected_evidence
):
    """Even in QA evidence mode, never persist the owner's Pix receiver tokens."""
    from contextlib import nullcontext
    from types import SimpleNamespace
    from unittest.mock import MagicMock
    from fastapi import HTTPException
    from app.routes import pagbank_payments
    from app.services.online_payments.oauth import MercadoPagoOAuthTokens

    monkeypatch.setenv('PAGBANK_ENV', 'sandbox')
    monkeypatch.setenv('PAGBANK_PRODUCTION_RESTAURANT_IDS', str(rid) if production else '')
    monkeypatch.setenv('PAGBANK_SANDBOX_OAUTH_EVIDENCE_RESTAURANT_IDS', '9')
    monkeypatch.setenv('PAGBANK_SANDBOX_QA9_OAUTH_EVIDENCE_ONLY', 'true' if flag else 'false')
    monkeypatch.setenv('PAGBANK_APPLICATION_OWNER_ACCOUNT_ID', 'ACCO_OWNER_TEST')
    monkeypatch.setenv('PAGBANK_PRODUCTION_APPLICATION_OWNER_ACCOUNT_ID', 'ACCO_OWNER_TEST')
    monkeypatch.setattr(pagbank_payments, 'require_tenant_id', lambda: rid)
    monkeypatch.setattr(pagbank_payments, 'tenant_session_scope', lambda db, tenant_id: nullcontext())
    monkeypatch.setattr(pagbank_payments, 'ensure_permission', lambda *args: None)
    monkeypatch.setattr(oauth, 'decode_state', lambda state, cookie: (rid, 'qa-admin'))
    captured_exchanges = []
    def fake_exchange(code, **kwargs):
        captured_exchanges.append((code, kwargs))
        return MercadoPagoOAuthTokens('private-access-token', 'private-refresh-token',
                                     None, 'ACCO_OWNER_TEST', 3600)
    monkeypatch.setattr(oauth, 'exchange', fake_exchange)
    stages = []
    monkeypatch.setattr(oauth, 'log_sandbox_oauth_evidence', lambda stage, **kwargs: stages.append(stage))

    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = SimpleNamespace(
        id='qa-admin', restaurante_id=rid, role='admin'
    )
    # This owner/evidence test starts with no receiver. Distinguish inventory
    # queries from the initiating user instead of returning a truthy admin for
    # every queried table (which incorrectly simulates an active direct Pix).
    from app.models import Usuario
    initiator_query = db.query.return_value
    def query(model):
        if model is Usuario:
            return initiator_query
        empty = MagicMock()
        empty.filter.return_value = empty
        empty.with_for_update.return_value = empty
        empty.one.return_value = SimpleNamespace(id=rid)
        empty.all.return_value = []
        empty.first.return_value = None
        return empty
    db.query.side_effect = query
    user = SimpleNamespace(id='qa-admin', restaurante_id=rid, role='admin')
    request = pagbank_payments.AuthorizationCompletion(code='one-time-code', state='signed-state')

    if expected_evidence:
        result = pagbank_payments.complete(request, db=db, user=user)
        assert result == {'status': 'sandbox_evidence_captured'}
        assert stages == ['connection_evidence_only']
    else:
        with pytest.raises(HTTPException) as rejected:
            pagbank_payments.complete(request, db=db, user=user)
        assert rejected.value.status_code == 409
        assert stages == ['connection_rejected_owner']

    assert len(captured_exchanges) == 1
    assert captured_exchanges[0][1]['environment'] == ('production' if production else 'sandbox')
    db.add.assert_not_called()
    db.commit.assert_not_called()
    db.query.return_value.filter.return_value.update.assert_not_called()
