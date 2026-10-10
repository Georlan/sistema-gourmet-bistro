import datetime
import json
from decimal import Decimal
from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from app.services.online_payments.pagbank import oauth
from app.services.online_payments.pagbank.provider import PagBankProvider, PagBankError, cents


@pytest.fixture(autouse=True)
def credentials(monkeypatch):
    for name in ('CLIENT_ID', 'CLIENT_SECRET', 'APP_TOKEN'):
        monkeypatch.setenv('PAGBANK_' + name, 'test-' + name)
    monkeypatch.setenv('PAGBANK_ENV', 'sandbox')
    monkeypatch.setenv('PAGBANK_OAUTH_REDIRECT_URI', 'https://api.example.test/payments/pagbank/oauth/callback')


def snapshot(status='WAITING', value=4590):
    return {'id': 'ORDE_test', 'reference_id': 'intent-test', 'charges': [{
        'id': 'CHAR_test', 'status': status, 'amount': {'value': value, 'currency': 'BRL'},
        'payment_method': {'type': 'PIX', 'pix': {'expiration_date': '2026-10-10T12:00:00Z'}},
        'qr_code': {'text': '000201-test-code'},
    }]}


def test_state_limit_signature_browser_binding_and_expiry(monkeypatch):
    uid = '00000000-0000-0000-0000-000000000001'
    url, state = oauth.authorization(8, uid)
    assert len(state) <= 128
    assert urlparse(url).hostname == 'connect.sandbox.pagbank.com.br'
    assert parse_qs(urlparse(url).query)['scope'] == ['payments.read payments.create payments.refund accounts.read']
    assert oauth.decode_state(state, state) == (8, uid)
    for value, cookie in ((state + 'x', state), (state, ''), (state, 'wrong')):
        with pytest.raises(oauth.PagBankOAuthError):
            oauth.decode_state(value, cookie)
    monkeypatch.setattr(oauth.time, 'time', lambda: 0)
    with pytest.raises(oauth.PagBankOAuthError):
        oauth.decode_state(state, state)


def test_refresh_headers_endpoint_and_rotation():
    requests = []
    def handle(req):
        requests.append(req)
        return httpx.Response(201, json={'access_token': 'new', 'refresh_token': 'rotated', 'account_id': 'ACCO_test', 'expires_in': 3600})
    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        data = oauth._post('/oauth2/refresh', {'grant_type': 'refresh_token', 'refresh_token': 'old'}, client=client)
    tokens = oauth._tokens(data)
    assert tokens.refresh_token == 'rotated'
    assert requests[0].headers['X_CLIENT_SECRET'] == 'test-CLIENT_SECRET'
    assert requests[0].url.path == '/oauth2/refresh'


def test_pix_uses_current_charge_contract_integer_cents_and_no_split():
    requests = []
    def handle(req):
        requests.append(req)
        return httpx.Response(201, json=snapshot())
    provider = PagBankProvider('seller-token')
    provider._client.close()
    provider._client = httpx.Client(base_url=oauth.api_url(), transport=httpx.MockTransport(handle))
    payment = provider.create_pix(amount=Decimal('45.90'), marketplace_fee=Decimal(0), payer_email='buyer@example.test',
        payer_name='Buyer', payer_tax_id='12345678909', external_reference='intent-test', idempotency_key='idem-key',
        notification_url='https://api.example.test/webhook', expires_at=datetime.datetime.now(datetime.timezone.utc))
    payload = json.loads(requests[0].content)
    assert payload['charges'][0]['amount'] == {'value': 4590, 'currency': 'BRL'}
    assert payload['charges'][0]['payment_method']['type'] == 'PIX'
    assert 'splits' not in payload and 'application_fee' not in payload
    assert payment.qr_code == '000201-test-code' and payment.status == 'pending'
    assert payment.amount == Decimal('45.90')
    provider._client.close()


@pytest.mark.parametrize('status, expected', [('PAID', 'approved'), ('DECLINED', 'rejected'), ('CANCELED', 'cancelled'), ('WAITING', 'pending')])
def test_charge_status_mapping(status, expected):
    assert PagBankProvider._map(snapshot(status)).status == expected


def test_rejects_currency_multiple_charges_non_pix_and_url_injection():
    for mutation in ('currency', 'multiple', 'method', 'id'):
        data = snapshot()
        if mutation == 'currency': data['charges'][0]['amount']['currency'] = 'USD'
        if mutation == 'multiple': data['charges'].append(data['charges'][0])
        if mutation == 'method': data['charges'][0]['payment_method']['type'] = 'BOLETO'
        if mutation == 'id': data['id'] = '../orders'
        with pytest.raises(PagBankError): PagBankProvider._map(data)
    with pytest.raises(PagBankError): cents(Decimal('1.001'))


def test_callback_connects_seller_in_state_tenant_and_revokes_before_disconnect(monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.database import SessionLocal, current_restaurante_id
    from app.models import Restaurante, Usuario, RestaurantPaymentAccount
    from app.routes import pagbank_payments
    from app.services.online_payments.oauth import MercadoPagoOAuthTokens

    rid = 9940
    context = current_restaurante_id.set(rid)
    db = SessionLocal()
    try:
        db.add(Restaurante(id=rid, nome='PagBank OAuth test', plano='pro'))
        db.flush()
        user = Usuario(id='pagbank-admin', restaurante_id=rid, nome='Admin', email='pg-admin@koma.test',
                       senha_hash='unused', role='admin', cargo='admin', status='ativo')
        db.add(user)
        db.commit()
        tokens = MercadoPagoOAuthTokens('seller-token', 'seller-refresh', None, 'ACCO_seller', 3600)
        monkeypatch.setattr(oauth, 'exchange', lambda code: tokens)
        _, state = oauth.authorization(rid, user.id)
        client = TestClient(app, base_url='https://testserver')
        response = client.get('/payments/pagbank/oauth/callback', params={'code': 'authorized', 'state': state}, follow_redirects=False)
        assert response.status_code == 303, response.text
        assert 'pagbank=authorized' in response.headers['location']
        assert db.query(RestaurantPaymentAccount).filter_by(restaurante_id=rid, provider='pagbank').count() == 0
        result = pagbank_payments.complete(pagbank_payments.AuthorizationCompletion(code='authorized', state=state), db=db, user=user)
        assert result['status'] == 'connected'
        account = db.query(RestaurantPaymentAccount).filter_by(restaurante_id=rid, provider='pagbank').one()
        assert account.access_token == 'seller-token'
        assert account._access_token != account.access_token
        assert account.provider_user_id == 'ACCO_seller'
        assert account.status == 'active'
        revoked = []
        monkeypatch.setattr(oauth, 'revoke', lambda token: revoked.append(token))
        result = pagbank_payments.disconnect(db=db, user=user)
        assert result['status'] == 'disconnected' and revoked == ['seller-token']
        assert account.access_token == ''
        from fastapi import HTTPException
        other_user = Usuario(id='another-admin', restaurante_id=rid, nome='Other', cargo='admin', role='admin')
        with pytest.raises(HTTPException) as denied:
            pagbank_payments.complete(pagbank_payments.AuthorizationCompletion(code='authorized', state=state), db=db, user=other_user)
        assert denied.value.status_code == 403
    finally:
        db.rollback()
        db.query(RestaurantPaymentAccount).filter_by(restaurante_id=rid).delete()
        db.query(Usuario).filter_by(restaurante_id=rid).delete()
        db.query(Restaurante).filter_by(id=rid).delete()
        db.commit()
        db.close()
        current_restaurante_id.reset(context)


def test_migration_sqlite_upgrade_and_downgrade_preserves_constraints():
    import importlib.util
    from pathlib import Path
    from sqlalchemy import create_engine, inspect
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from app.database import Base

    path = Path(__file__).parents[1] / 'alembic/versions/6a7b8c9d0e12_pagbank_connect.py'
    spec = importlib.util.spec_from_file_location('pagbank_migration', path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine('sqlite://')
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        connection.exec_driver_sql('ALTER TABLE restaurant_payment_accounts DROP COLUMN provider_environment')
    with engine.begin() as connection:
        operations = Operations(MigrationContext.configure(connection))
        with operations.context(operations.migration_context):
            migration.upgrade()
            for table, (name, _) in migration.TABLES.items():
                constraints = {c['name']: c['sqltext'] for c in inspect(connection).get_check_constraints(table)}
                assert 'pagbank' in constraints[name]
            migration.downgrade()
            for table, (name, _) in migration.TABLES.items():
                constraints = {c['name']: c['sqltext'] for c in inspect(connection).get_check_constraints(table)}
                assert 'pagbank' not in constraints[name]
    engine.dispose()


def test_reconnecting_mercado_pago_selects_only_one_automatic_receiver():
    from app.database import SessionLocal, current_restaurante_id
    from app.models import Restaurante, RestaurantPaymentAccount
    from app.services.online_payments.account_connection import upsert_mercado_pago_account
    from app.services.online_payments.oauth import MercadoPagoOAuthTokens

    rid = 9941
    context = current_restaurante_id.set(rid)
    db = SessionLocal()
    try:
        db.add(Restaurante(id=rid, nome='Switch receiver', plano='pro'))
        db.flush()
        pagbank = RestaurantPaymentAccount(restaurante_id=rid, provider='pagbank', provider_environment='sandbox',
            provider_user_id='ACCO_switch', status='active')
        pagbank.access_token = 'historic-seller-token'
        pagbank.webhook_secret = 'historic-seller-token'
        db.add(pagbank)
        db.commit()
        account = upsert_mercado_pago_account(db, restaurant_id=rid,
            tokens=MercadoPagoOAuthTokens('mp-seller-token', 'mp-refresh', None, 'mp-switch', 3600), webhook_secret='mp-secret')
        db.commit()
        assert account.status == 'active'
        assert pagbank.status == 'disconnected'
        assert pagbank.access_token == 'historic-seller-token'
        assert db.query(RestaurantPaymentAccount).filter_by(restaurante_id=rid, status='active').count() == 1
    finally:
        db.rollback()
        db.query(RestaurantPaymentAccount).filter_by(restaurante_id=rid).delete()
        db.query(Restaurante).filter_by(id=rid).delete()
        db.commit()
        db.close()
        current_restaurante_id.reset(context)
