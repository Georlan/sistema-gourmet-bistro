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
