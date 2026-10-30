import datetime
import json
from decimal import Decimal
from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from app.services.online_payments.pagbank import oauth
from app.services.online_payments.pagbank.provider import PagBankProvider, PagBankError, cents
from app.services.online_payments.pagbank.provider import valid_order_payer_email


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


@pytest.mark.parametrize('email,accepted', [
    ('cliente@email.com', True),
    (' Comprador+teste@Email.com.br ', True),
    ('a@b.co', True),
    ('a@usp.br', True),
    ('a@b.c', False),
    ('user@example.c', False),
    ('sem-arroba', False),
    ('x @example.com', False),
])
def test_online_pix_email_validated_before_pagbank_api(email, accepted):
    assert valid_order_payer_email(email) is accepted


def test_pagbank_provider_never_requests_invalid_payer_email():
    provider = PagBankProvider('seller-token')
    try:
        with pytest.raises(PagBankError, match='e-mail válido'):
            provider.create_pix(
                amount=Decimal('4.50'), marketplace_fee=Decimal('0'),
                payer_email='sem-arroba', payer_name='Comprador Teste',
                payer_tax_id='12345678909', external_reference='intent-test',
                idempotency_key='idem-valid', notification_url='https://api.example.test/webhook',
                expires_at=datetime.datetime.now(datetime.timezone.utc),
            )
    finally:
        provider._client.close()


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


@pytest.mark.parametrize('payload, expected_reason', [
    ({'error': 'invalid_grant'}, 'invalid_grant'),
    ({'errors': [{'code': '41004'}]}, '41004'),
    ({'error_messages': [{'code': '41004', 'description': 'invalid_grant'}]}, '41004'),
    ({'error': 'buyer@private.example', 'description': 'secret-value'}, 'unknown'),
])
def test_connect_rejection_logs_only_allowlisted_metadata(payload, expected_reason, caplog):
    def handle(req):
        return httpx.Response(400, json=payload)

    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        with pytest.raises(oauth.PagBankOAuthError) as failure:
            oauth._post('/oauth2/token', {'grant_type': 'authorization_code', 'code': 'private-code'}, client=client)
    assert failure.value.reason == expected_reason
    assert 'http_status=400' in caplog.text
    assert f'error_code={expected_reason}' in caplog.text
    assert 'buyer@private.example' not in caplog.text
    assert 'secret-value' not in caplog.text
    assert 'private-code' not in caplog.text


def test_connect_rejects_non_object_token_response_without_leaking_body(caplog):
    def handle(req):
        return httpx.Response(200, json=['secret-value'])

    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        with pytest.raises(oauth.PagBankOAuthError) as failure:
            oauth._post(
                '/oauth2/token',
                {'grant_type': 'authorization_code', 'code': 'do-not-log'},
                client=client,
            )
    assert failure.value.reason == 'invalid_response'
    assert 'secret-value' not in caplog.text
    assert 'do-not-log' not in caplog.text


def test_incomplete_connect_response_is_classified_without_tokens(caplog):
    with pytest.raises(oauth.PagBankOAuthError) as failure:
        oauth._tokens({'access_token': 'private-access-token'})
    assert failure.value.reason == 'incomplete_response'
    assert 'account_id_present=False' in caplog.text
    assert 'private-access-token' not in caplog.text


@pytest.mark.parametrize('error_code', ['40001', '40002'])
def test_provider_maps_bank_customer_email_rejection_without_leaking_pii(caplog, error_code):
    requests = []

    def handler(req):
        requests.append(req)
        return httpx.Response(400, json={'error_messages': [{
            'code': error_code,
            'parameter_name': 'customer.email',
            'description': 'buyer email must not be equals to merchant email private@example.test',
        }]})
    provider = PagBankProvider('seller-token')
    provider._client.close()
    provider._client = httpx.Client(base_url=oauth.api_url(), transport=httpx.MockTransport(handler))
    try:
        with pytest.raises(PagBankError) as failure:
            provider.create_pix(
                amount=Decimal('6'), marketplace_fee=Decimal('0'),
                payer_email='private@example.test', payer_name='Buyer',
                payer_tax_id='12345678909', external_reference='intent-test',
                idempotency_key='idem-email', notification_url='https://api.example.test/webhook',
                expires_at=datetime.datetime.now(datetime.timezone.utc),
            )
        assert failure.value.reason == 'customer_email_rejected'
        assert failure.value.status_code == 400
        assert not failure.value.retryable
        assert len(requests) == 1
        assert 'private@example.test' not in caplog.text
        assert 'seller-token' not in caplog.text
        assert error_code in caplog.text
        assert 'customer.email' in caplog.text
    finally:
        provider._client.close()


def test_provider_does_not_classify_unrelated_40002_as_customer_email():
    def handler(req):
        return httpx.Response(400, json={'error_messages': [{
            'code': '40002', 'parameter_name': 'items[0].quantity',
        }]})
    provider = PagBankProvider('seller-token')
    provider._client.close()
    provider._client = httpx.Client(base_url=oauth.api_url(), transport=httpx.MockTransport(handler))
    try:
        with pytest.raises(PagBankError) as failure:
            provider.create_pix(
                amount=Decimal('6'), marketplace_fee=Decimal('0'),
                payer_email='buyer@example.test', payer_name='Buyer',
                payer_tax_id='12345678909', external_reference='intent-test',
                idempotency_key='idem-other', notification_url='https://api.example.test/webhook',
                expires_at=datetime.datetime.now(datetime.timezone.utc),
            )
        assert failure.value.reason is None
        assert failure.value.status_code == 400
    finally:
        provider._client.close()


def test_pix_uses_current_charge_contract_integer_cents_and_no_split():
    requests = []
    def handle(req):
        requests.append(req)
        return httpx.Response(201, json=snapshot())
    provider = PagBankProvider('seller-token')
    provider._client.close()
    provider._client = httpx.Client(base_url=oauth.api_url(), transport=httpx.MockTransport(handle))
    payment = provider.create_pix(amount=Decimal('45.90'), marketplace_fee=Decimal(0), payer_email=' buyer@example.test ',
        payer_name='Buyer', payer_tax_id='12345678909', external_reference='intent-test', idempotency_key='idem-key',
        notification_url='https://api.example.test/webhook', expires_at=datetime.datetime.now(datetime.timezone.utc))
    payload = json.loads(requests[0].content)
    assert payload['customer']['email'] == 'buyer@example.test'
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


@pytest.mark.parametrize('environment', ['sandbox', 'production'])
def test_callback_connects_seller_and_disconnect_preserves_historical_credentials(monkeypatch, environment):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.database import SessionLocal, current_restaurante_id
    from app.models import Restaurante, Usuario, RestaurantPaymentAccount
    from app.routes import pagbank_payments
    from app.services.online_payments.oauth import MercadoPagoOAuthTokens

    rid = 9940
    if environment == 'production':
        monkeypatch.setenv('PAGBANK_PRODUCTION_RESTAURANT_IDS', str(rid))
        for name in ('CLIENT_ID', 'CLIENT_SECRET', 'APP_TOKEN'):
            monkeypatch.setenv('PAGBANK_PRODUCTION_' + name, 'production-' + name)
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
        exchanged = []
        def exchange(code, **kwargs):
            exchanged.append(kwargs['environment'])
            return tokens
        monkeypatch.setattr(oauth, 'exchange', exchange)
        _, state = oauth.authorization(rid, user.id)
        client = TestClient(app, base_url='https://testserver')
        response = client.get('/payments/pagbank/oauth/callback', params={'code': 'authorized', 'state': state}, follow_redirects=False)
        assert response.status_code == 303, response.text
        assert 'pagbank=authorized' in response.headers['location']
        assert db.query(RestaurantPaymentAccount).filter_by(restaurante_id=rid, provider='pagbank').count() == 0
        result = pagbank_payments.complete(pagbank_payments.AuthorizationCompletion(code='authorized', state=state), db=db, user=user)
        assert result['status'] == 'connected'
        account = db.query(RestaurantPaymentAccount).filter_by(restaurante_id=rid, provider='pagbank').one()
        assert exchanged == [environment]
        assert account.provider_environment == environment
        status = pagbank_payments.connection_status(db=db, user=user)
        assert status['connected'] and status['environment'] == environment
        assert account.access_token == 'seller-token'
        assert account._access_token != account.access_token
        assert account.provider_user_id == 'ACCO_seller'
        assert account.status == 'active'
        # A failed reconnection must preserve the already connected receiver.
        def expired_exchange(code, **kwargs):
            raise oauth.PagBankOAuthError('Authorization rejected', reason='invalid_grant')
        monkeypatch.setattr(oauth, 'exchange', expired_exchange)
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as invalid_grant:
            pagbank_payments.complete(
                pagbank_payments.AuthorizationCompletion(code='used-code', state=state),
                db=db, user=user,
            )
        assert invalid_grant.value.status_code == 409
        assert 'nova conexão' in invalid_grant.value.detail
        db.refresh(account)
        assert account.status == 'active'
        assert account.access_token == 'seller-token'

        def inactive_app_exchange(code, **kwargs):
            raise oauth.PagBankOAuthError('inactive token', reason='41012')
        monkeypatch.setattr(oauth, 'exchange', inactive_app_exchange)
        with pytest.raises(HTTPException) as inactive_app:
            pagbank_payments.complete(
                pagbank_payments.AuthorizationCompletion(code='fresh-code', state=state),
                db=db, user=user,
            )
        assert inactive_app.value.status_code == 503
        assert 'suporte KÔMA' in inactive_app.value.detail
        assert 'preservada' in inactive_app.value.detail
        db.refresh(account)
        assert account.status == 'active'
        assert account.access_token == 'seller-token'
        revoked = []
        monkeypatch.setattr(oauth, 'revoke', lambda token, **kwargs: revoked.append((token, kwargs['environment'])))
        result = pagbank_payments.disconnect(db=db, user=user)
        assert result['status'] == 'disconnected' and revoked == []
        assert account.access_token == 'seller-token'
        assert account.refresh_token == 'seller-refresh'
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


def test_mercado_pago_requires_explicit_disconnect_of_other_receivers():
    import datetime
    from app.database import SessionLocal, current_restaurante_id
    from app.models import Restaurante, RestaurantPaymentAccount, RestaurantDirectPixConfig
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
        manual = RestaurantDirectPixConfig(restaurante_id=rid, enabled=True, key_type='email', pix_key='seller@example.test', holder_name='SELLER', city='FORTALEZA', accepted_by='test-admin', accepted_at=datetime.datetime.now(datetime.timezone.utc), terms_version='direct-pix-v1')
        db.add(manual)
        db.commit()
        from app.services.online_payments.account_connection import MercadoPagoAccountConnectionError
        with pytest.raises(MercadoPagoAccountConnectionError, match='Desconecte'):
            upsert_mercado_pago_account(db, restaurant_id=rid,
                tokens=MercadoPagoOAuthTokens('mp-seller-token', 'mp-refresh', None, 'mp-switch', 3600), webhook_secret='mp-secret')
        assert pagbank.status == 'active' and manual.enabled
        pagbank.status = 'disconnected'
        manual.enabled = False
        db.commit()
        account = upsert_mercado_pago_account(db, restaurant_id=rid,
            tokens=MercadoPagoOAuthTokens('mp-seller-token', 'mp-refresh', None, 'mp-switch', 3600), webhook_secret='mp-secret')
        db.commit()
        assert manual.enabled is False
        assert account.status == 'active'
        assert pagbank.status == 'disconnected'
        assert pagbank.access_token == 'historic-seller-token'
        assert db.query(RestaurantPaymentAccount).filter_by(restaurante_id=rid, status='active').count() == 1
    finally:
        db.rollback()
        db.query(RestaurantDirectPixConfig).filter_by(restaurante_id=rid).delete()
        db.query(RestaurantPaymentAccount).filter_by(restaurante_id=rid).delete()
        db.query(Restaurante).filter_by(id=rid).delete()
        db.commit()
        db.close()
        current_restaurante_id.reset(context)


def test_pagbank_webhook_signature_validation_and_sandbox_fallback(monkeypatch):
    import hashlib
    from fastapi.testclient import TestClient
    from app.main import app
    from app.database import SessionLocal, current_restaurante_id
    from app.models import Restaurante, Usuario, Comanda, CaixaTurno, OnlinePaymentIntent, RestaurantPaymentAccount, OnlinePaymentWebhookEvent, Pagamento
    from app.services.online_payments.base import ProviderPayment

    rid = 9942
    context = current_restaurante_id.set(rid)
    db = SessionLocal()
    try:
        db.add(Restaurante(id=rid, nome='PagBank Webhook Test', plano='pro'))
        db.flush()
        user = Usuario(id='admin-test-9942', restaurante_id=rid, nome='Admin', email='admin-9942@test.com', senha_hash='x', role='admin', cargo='admin', status='ativo')
        db.add(user)
        db.flush()
        shift = CaixaTurno(restaurante_id=rid, aberto_por_id=user.id, status='aberto', saldo_inicial=0.0)
        db.add(shift)
        db.flush()
        comanda = Comanda(id='comanda-test-9942', restaurante_id=rid, garcom_id=user.id, numero_pedido=101, identificador='Mesa 1', status_comanda=None, tipo='Consumo no Local', delivery_status='pendente', online_payment_status='pending')
        db.add(comanda)
        db.flush()
        intent = OnlinePaymentIntent(
            id='intent-pg-hook-test',
            restaurante_id=rid,
            comanda_id=comanda.id,
            turno_id=shift.id,
            provider='pagbank',
            method='pix',
            status='pending',
            amount=30.00,
            marketplace_fee=0.00,
            fee_settlement='none',
            idempotency_key='idem-hook-test',
            external_payment_id='ORDE_HOOK_TEST_123',
        )
        db.add(intent)
        account = RestaurantPaymentAccount(
            id='acc-pg-hook-123',
            restaurante_id=rid,
            provider='pagbank',
            provider_environment='sandbox',
            provider_user_id='ACCO_HOOK_SELLER',
            status='active',
        )
        account.access_token = 'seller-webhook-secret-token'
        account.webhook_secret = 'seller-webhook-secret-token'
        db.add(account)
        db.commit()

        client = TestClient(app, base_url='https://testserver')
        raw_body = b'{"id": "ORDE_HOOK_TEST_123"}'

        # Mock PagBankProvider.get_payment to return approved payment
        fake_payment = ProviderPayment(
            external_id='ORDE_HOOK_TEST_123',
            status='approved',
            amount=Decimal('30.00'),
            external_reference='intent-pg-hook-test',
            qr_code='000201-pix',
        )
        monkeypatch.setattr(PagBankProvider, 'get_payment', lambda self, pid: fake_payment)

        # 1. Tampered signature -> 401 Assinatura divergente.
        res = client.post(
            f'/payments/webhooks/pagbank/{account.id}',
            content=raw_body,
            headers={'Content-Type': 'application/json', 'x-authenticity-token': 'bad-signature'},
        )
        assert res.status_code == 401
        assert 'Assinatura divergente' in res.json()['detail']

        # 2. Production with missing signature -> 401 Assinatura ausente.
        monkeypatch.setenv('PAGBANK_ENV', 'production')
        account.provider_environment = 'production'
        db.commit()
        res = client.post(
            f'/payments/webhooks/pagbank/{account.id}',
            content=raw_body,
            headers={'Content-Type': 'application/json'},
        )
        assert res.status_code == 401
        assert 'Assinatura ausente' in res.json()['detail']

        # 3. Wrong token signature -> 401 Assinatura divergente
        wrong_sig = hashlib.sha256(b'wrong-platform-token-' + raw_body).hexdigest()
        rejected = client.post(
            f'/payments/webhooks/pagbank/{account.id}',
            content=raw_body,
            headers={'Content-Type': 'application/json', 'x-authenticity-token': wrong_sig},
        )
        assert rejected.status_code == 401
        assert 'Assinatura divergente' in rejected.json()['detail']

        # 4. A shared app-token signature is NOT authorized for a
        # third-party seller, even when its Connect account is active.
        platform_signature = hashlib.sha256(b'test-APP_TOKEN-' + raw_body).hexdigest()
        rejected_platform = client.post(
            f'/payments/webhooks/pagbank/{account.id}',
            content=raw_body,
            headers={'Content-Type': 'application/json', 'x-authenticity-token': platform_signature},
        )
        assert rejected_platform.status_code == 401

        # The scoped seller's token can authenticate its own webhook.
        seller_signature = hashlib.sha256(b'seller-webhook-secret-token-' + raw_body).hexdigest()
        res = client.post(
            f'/payments/webhooks/pagbank/{account.id}',
            content=raw_body,
            headers={'Content-Type': 'application/json', 'x-authenticity-token': seller_signature},
        )
        assert res.status_code == 200
        assert res.json()['status'] == 'processed'

        # 5. Replay remains idempotent.
        res = client.post(
            f'/payments/webhooks/pagbank/{account.id}',
            content=raw_body,
            headers={'Content-Type': 'application/json', 'x-authenticity-token': seller_signature},
        )
        assert res.status_code == 200
        assert res.json()['status'] == 'already_processed'

        # 5. Sandbox without signature -> rejected with 401
        monkeypatch.setenv('PAGBANK_ENV', 'sandbox')
        account.provider_environment = 'sandbox'
        # Create second order and comanda for sandbox test
        comanda2 = Comanda(id='comanda-test-9942-2', restaurante_id=rid, garcom_id=user.id, numero_pedido=103, identificador='Mesa 2', status_comanda=None, tipo='Consumo no Local', delivery_status='pendente', online_payment_status='pending')
        db.add(comanda2)
        db.flush()
        intent2 = OnlinePaymentIntent(
            id='intent-pg-hook-test-2',
            restaurante_id=rid,
            comanda_id=comanda2.id,
            turno_id=shift.id,
            provider='pagbank',
            method='pix',
            status='pending',
            amount=30.00,
            marketplace_fee=0.00,
            fee_settlement='none',
            idempotency_key='idem-hook-test-2',
            external_payment_id='ORDE_HOOK_TEST_456',
        )
        db.add(intent2)
        db.commit()

        fake_payment2 = ProviderPayment(
            external_id='ORDE_HOOK_TEST_456',
            status='approved',
            amount=Decimal('30.00'),
            external_reference='intent-pg-hook-test-2',
            qr_code='000201-pix',
        )
        monkeypatch.setattr(PagBankProvider, 'get_payment', lambda self, pid: fake_payment2)

        raw_body_sandbox = b'{"id": "ORDE_HOOK_TEST_456"}'
        res = client.post(
            f'/payments/webhooks/pagbank/{account.id}',
            content=raw_body_sandbox,
            headers={'Content-Type': 'application/json'},  # no x-authenticity-token!
        )
        assert res.status_code == 401
        assert 'Assinatura ausente' in res.json()['detail']
        db.refresh(intent2)
        assert intent2.status == 'pending'

        # 6. Sandbox with valid signature -> processes successfully
        valid_sig_sandbox = hashlib.sha256(b'seller-webhook-secret-token-' + raw_body_sandbox).hexdigest()
        res = client.post(
            f'/payments/webhooks/pagbank/{account.id}',
            content=raw_body_sandbox,
            headers={'Content-Type': 'application/json', 'x-authenticity-token': valid_sig_sandbox},
        )
        assert res.status_code == 200
        assert res.json()['status'] == 'processed'
        db.refresh(intent2)
        assert intent2.status == 'approved'

    finally:
        db.rollback()
        db.query(OnlinePaymentWebhookEvent).filter_by(restaurante_id=rid).delete()
        db.query(OnlinePaymentIntent).filter_by(restaurante_id=rid).delete()
        db.query(RestaurantPaymentAccount).filter_by(restaurante_id=rid).delete()
        db.query(Pagamento).filter_by(restaurante_id=rid).delete()
        db.query(Comanda).filter_by(restaurante_id=rid).delete()
        db.query(CaixaTurno).filter_by(restaurante_id=rid).delete()
        db.query(Usuario).filter_by(restaurante_id=rid).delete()
        db.query(Restaurante).filter_by(id=rid).delete()
        db.commit()
        db.close()
        current_restaurante_id.reset(context)


@pytest.mark.parametrize('initial_result', ['approved', 'timeout', 'pending', 'cancelled'])
def test_cardapio_polling_reconciles_and_guards_against_premature_expiration(monkeypatch, initial_result):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.database import SessionLocal, current_restaurante_id
    from app.models import Restaurante, Usuario, Comanda, CaixaTurno, OnlinePaymentIntent, RestaurantPaymentAccount, Item, Lancamento, Produto, Categoria, Pagamento, OnlinePaymentWebhookEvent
    from app.services.online_payments.base import ProviderPayment

    rid = 9943
    context = current_restaurante_id.set(rid)
    db = SessionLocal()
    try:
        db.add(Restaurante(id=rid, nome='Cardapio Polling Test', plano='pro'))
        db.flush()
        user = Usuario(id='admin-test-9943', restaurante_id=rid, nome='Admin', email='admin-9943@test.com', senha_hash='x', role='admin', cargo='admin', status='ativo')
        db.add(user)
        db.flush()
        shift = CaixaTurno(restaurante_id=rid, aberto_por_id=user.id, status='aberto', saldo_inicial=0.0)
        db.add(shift)
        db.flush()
        cat = Categoria(id='cat-test-9943', restaurante_id=rid, nome='Lanches')
        db.add(cat)
        db.flush()
        prod = Produto(id='prod-test-9943', restaurante_id=rid, categoria_id=cat.id, nome='Burger', preco=20.0)
        db.add(prod)
        db.flush()
        comanda = Comanda(id='comanda-test-9943', restaurante_id=rid, garcom_id=user.id, numero_pedido=102, identificador='Cliente Online', status_comanda=None, tipo='Delivery', delivery_status='pendente', online_payment_status='pending', idempotency_key='key-test-9943')
        db.add(comanda)
        db.flush()
        lanc = Lancamento(id='lanc-test-9943', restaurante_id=rid, comanda_id=comanda.id, garcom_id=user.id, status='pendente')
        db.add(lanc)
        db.flush()
        item = Item(id='item-test-9943', restaurante_id=rid, comanda_id=comanda.id, lancamento_id=lanc.id, produto_id=prod.id, preco_unit=20.0, status='preparando', pago=False)
        db.add(item)
        db.flush()

        # Payment intent expired 10 seconds ago locally, BUT was paid at PagBank!
        past_time = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(seconds=10)
        intent = OnlinePaymentIntent(
            id='intent-poll-test-1',
            restaurante_id=rid,
            comanda_id=comanda.id,
            turno_id=shift.id,
            provider='pagbank',
            method='pix',
            status='pending',
            amount=20.00,
            marketplace_fee=0.00,
            fee_settlement='none',
            idempotency_key='idem-poll-test',
            external_payment_id='ORDE_POLL_TEST_789',
            expires_at=past_time,
            updated_at=past_time,
        )
        db.add(intent)
        account = RestaurantPaymentAccount(
            id='acc-pg-poll-1',
            restaurante_id=rid,
            provider='pagbank',
            provider_environment='sandbox',
            provider_user_id='ACCO_POLL_SELLER',
            status='active',
        )
        account.access_token = 'poll-seller-token'
        account.webhook_secret = 'poll-seller-token'
        db.add(account)
        db.commit()

        # Mock PagBankProvider.get_payment returning status approved (PAID)
        fake_payment = ProviderPayment(
            external_id='ORDE_POLL_TEST_789',
            status='approved',
            amount=Decimal('20.00'),
            external_reference='intent-poll-test-1',
            qr_code='000201-pix',
        )
        calls = []
        def provider_result(self, pid):
            calls.append(pid)
            if initial_result == 'timeout':
                raise PagBankError('unavailable', retryable=True)
            from dataclasses import replace
            return replace(fake_payment, status=initial_result)
        monkeypatch.setattr(PagBankProvider, 'get_payment', provider_result)
        client = TestClient(app, base_url='https://testserver')
        url = '/cardapio/pedidos/comanda-test-9943/status'
        assert intent.status == 'pending'  # Keep an older snapshot in this session.
        for _ in range(2):
            res = client.get(url, params={'key': 'key-test-9943'})
            assert res.status_code == 200, res.text
        assert len(calls) == 1
        if initial_result == 'approved':
            from dataclasses import replace
            from app.services.online_payments import OnlinePaymentService
            settled, approved = OnlinePaymentService.apply_provider_snapshot_in_session(
                db, account=account, intent=intent, payment=replace(fake_payment, status='pending'))
            assert settled.status == 'approved'
            assert approved is False
            db.commit()
        db.refresh(comanda)
        db.refresh(intent)
        assert intent.reconciliation_attempted_at is not None
        if initial_result == 'cancelled':
            assert intent.status == 'cancelled'
            assert comanda.fechada is True
            import hashlib
            monkeypatch.setattr(PagBankProvider, 'get_payment', lambda self, pid: fake_payment)
            raw = b'{"id":"ORDE_POLL_TEST_789","event":"late-paid"}'
            response = client.post('/payments/webhooks/pagbank/acc-pg-poll-1', content=raw,
                headers={'Content-Type': 'application/json', 'x-authenticity-token': hashlib.sha256(b'poll-seller-token-' + raw).hexdigest()})
            assert response.status_code == 409
            audit = db.query(OnlinePaymentWebhookEvent).filter_by(restaurante_id=rid).one()
            assert audit.status == 'failed'
            assert 'revisão' in audit.last_error
            db.refresh(comanda)
            assert comanda.fechada is True
        elif initial_result == 'approved':
            assert intent.status == 'approved'
            assert comanda.fechada is False
        else:
            assert intent.status == 'pending'
            assert comanda.fechada is False
            assert comanda.online_payment_status == 'pending'
            assert res.json()['status'] == 'aguardando_pagamento'
            from app.routes import pagbank_payments
            queue = pagbank_payments.reconciliation_queue(db=db, user=user)
            assert queue['items'][0]['id'] == intent.id
            assert 'access_token' not in json.dumps(queue, default=str)
            assert client.get('/payments/pagbank/reconciliation').status_code in {401, 403}
            from fastapi import HTTPException
            with pytest.raises(HTTPException) as missing:
                pagbank_payments.retry_reconciliation('foreign-intent', db=db, user=user)
            assert missing.value.status_code == 404
            # A later authenticated observation recovers the uncertain payment.
            intent.reconciliation_attempted_at = past_time - datetime.timedelta(seconds=120)
            db.commit()
            monkeypatch.setattr(PagBankProvider, 'get_payment', lambda self, pid: fake_payment)
            recovered = pagbank_payments.retry_reconciliation(intent.id, db=db, user=user)
            assert recovered == {'status': 'approved', 'queried': True}
            db.refresh(comanda)
            assert comanda.fechada is False
        assert db.query(Pagamento).filter_by(restaurante_id=rid).count() == (0 if initial_result == 'cancelled' else 1)

    finally:
        db.rollback()
        db.query(OnlinePaymentWebhookEvent).filter_by(restaurante_id=rid).delete()
        db.query(OnlinePaymentIntent).filter_by(restaurante_id=rid).delete()
        db.query(RestaurantPaymentAccount).filter_by(restaurante_id=rid).delete()
        db.query(Pagamento).filter_by(restaurante_id=rid).delete()
        db.query(Item).filter_by(restaurante_id=rid).delete()
        db.query(Lancamento).filter_by(restaurante_id=rid).delete()
        db.query(Produto).filter_by(restaurante_id=rid).delete()
        db.query(Categoria).filter_by(restaurante_id=rid).delete()
        db.query(Comanda).filter_by(restaurante_id=rid).delete()
        db.query(CaixaTurno).filter_by(restaurante_id=rid).delete()
        db.query(Usuario).filter_by(restaurante_id=rid).delete()
        db.query(Restaurante).filter_by(id=rid).delete()
        db.commit()
        db.close()
        current_restaurante_id.reset(context)



def test_oauth_state_cannot_cross_environments(monkeypatch):
    _, state = oauth.authorization(9943, 'admin')
    monkeypatch.setenv('PAGBANK_ENV', 'production')
    with pytest.raises(oauth.PagBankOAuthError):
        oauth.decode_state(state, state)


def test_reconciliation_migration_roundtrip():
    import importlib.util
    from pathlib import Path
    from sqlalchemy import create_engine, inspect
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    engine = create_engine('sqlite://')
    path = Path(__file__).parents[1] / 'alembic/versions/7b8c9d0e1f23_payment_reconciliation_attempt.py'
    spec = importlib.util.spec_from_file_location('reconciliation_migration', path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    with engine.begin() as connection:
        connection.exec_driver_sql('CREATE TABLE online_payment_intents (id TEXT PRIMARY KEY)')
        connection.exec_driver_sql("INSERT INTO online_payment_intents VALUES ('historic')")
        operations = Operations(MigrationContext.configure(connection))
        with operations.context(operations.migration_context):
            migration.upgrade()
            assert 'reconciliation_attempted_at' in {c['name'] for c in inspect(connection).get_columns('online_payment_intents')}
            assert connection.exec_driver_sql('SELECT id, reconciliation_attempted_at FROM online_payment_intents').one() == ('historic', None)
            migration.downgrade()
            assert connection.exec_driver_sql('SELECT id FROM online_payment_intents').scalar() == 'historic'


def test_production_pilot_is_tenant_scoped_and_never_reuses_sandbox_credentials(monkeypatch):
    monkeypatch.setenv('PAGBANK_PRODUCTION_RESTAURANT_IDS', '8')
    assert oauth.environment_for_restaurant(8) == 'production'
    assert oauth.environment_for_restaurant(6) == 'sandbox'
    assert not oauth.configured('production')
    with pytest.raises(oauth.PagBankOAuthError):
        oauth.authorization(8, 'admin')
    for name in ('CLIENT_ID', 'CLIENT_SECRET', 'APP_TOKEN'):
        monkeypatch.setenv('PAGBANK_PRODUCTION_' + name, 'production-' + name)
    prod, state = oauth.authorization(8, 'admin')
    sandbox, other_state = oauth.authorization(6, 'admin')
    assert urlparse(prod).hostname == 'connect.pagbank.com.br'
    assert parse_qs(urlparse(prod).query)['client_id'] == ['production-CLIENT_ID']
    assert urlparse(sandbox).hostname == 'connect.sandbox.pagbank.com.br'
    assert parse_qs(urlparse(sandbox).query)['client_id'] == ['test-CLIENT_ID']
    assert oauth.decode_state(state, state) == (8, 'admin')
    assert oauth.decode_state(other_state, other_state) == (6, 'admin')
    monkeypatch.delenv('PAGBANK_PRODUCTION_RESTAURANT_IDS')
    with pytest.raises(oauth.PagBankOAuthError):
        oauth.decode_state(state, state)
    assert oauth.decode_state(other_state, other_state) == (6, 'admin')


def test_production_oauth_uses_only_production_application_credentials(monkeypatch):
    for name in ('CLIENT_ID', 'CLIENT_SECRET', 'APP_TOKEN'):
        monkeypatch.setenv('PAGBANK_PRODUCTION_' + name, 'production-' + name)
    captured = []
    def handle(request):
        captured.append(request)
        return httpx.Response(201, json={'access_token':'seller-production', 'account_id':'ACCO_prod', 'expires_in':3600})
    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        oauth._post('/oauth2/refresh', {'refresh_token':'seller-refresh'}, environment='production', client=client)
        oauth._post('/oauth2/refresh', {'refresh_token':'sandbox-refresh'}, environment='sandbox', client=client)
    assert captured[0].url.host == 'api.pagseguro.com'
    assert captured[0].headers['Authorization'] == 'Bearer production-APP_TOKEN'
    assert captured[0].headers['X_CLIENT_SECRET'] == 'production-CLIENT_SECRET'
    assert captured[1].url.host == 'sandbox.api.pagseguro.com'
    assert captured[1].headers['Authorization'] == 'Bearer test-APP_TOKEN'


def test_payment_adapter_uses_account_environment_when_pilot_policy_changes(monkeypatch):
    from app.models import RestaurantPaymentAccount
    from app.services.online_payments.provider_registry import provider_for_account
    monkeypatch.setenv('PAGBANK_PRODUCTION_RESTAURANT_IDS', '8')
    for environment, host in [('sandbox','sandbox.api.pagseguro.com'),('production','api.pagseguro.com')]:
        account = RestaurantPaymentAccount(restaurante_id=8, provider='pagbank', access_token='seller', provider_environment=environment)
        adapter = provider_for_account(account)
        try:
            assert adapter._client.base_url.host == host
        finally:
            adapter._client.close()
    with pytest.raises(oauth.PagBankOAuthError):
        PagBankProvider('seller', environment='untrusted-host')


@pytest.mark.parametrize('origin', ['https://app.komafood.com.br', 'https://komafood.com.br', 'https://sistema-gourmet-bistro.pages.dev'])
def test_oauth_returns_to_same_origin_without_moving_browser_session(origin, monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app
    uid = '00000000-0000-0000-0000-000000000001'
    from fastapi import Request, Response
    from types import SimpleNamespace
    from app.database import current_restaurante_id
    from app.routes import pagbank_payments
    monkeypatch.setattr(pagbank_payments, 'ensure_receiver_available', lambda db, **kw: None)
    context = current_restaurante_id.set(8)
    try:
        result = pagbank_payments.connect(request=Request({'type': 'http', 'headers': [(b'origin', origin.encode())]}),
            response=Response(), user=SimpleNamespace(id=uid))
    finally:
        current_restaurante_id.reset(context)
    state = parse_qs(urlparse(result['authorization_url']).query)['state'][0]
    assert len(state) <= 128
    assert oauth.decode_state(state, state) == (8, uid)
    with TestClient(app) as client:
        response = client.get('/payments/pagbank/oauth/callback', params={'state': state, 'code': 'test-code'}, follow_redirects=False)
    assert response.status_code == 303
    target = urlparse(response.headers['location'])
    assert target.scheme + '://' + target.netloc == origin
    assert parse_qs(target.query)['state'] == [state]
    assert response.headers['cache-control'] == 'no-store'


def test_oauth_return_origin_cannot_be_redirected_or_tampered():
    import base64
    for origin in ['https://attacker.example', 'https://app.komafood.com.br.attacker.example', 'https://app.komafood.com.br/path', 'http://app.komafood.com.br']:
        with pytest.raises(oauth.PagBankOAuthError):
            oauth.authorization(8, 'admin', return_origin=origin)
    _, state = oauth.authorization(8, 'admin', return_origin='https://app.komafood.com.br')
    raw = base64.urlsafe_b64decode(state + '=' * (-len(state) % 4))
    parts = raw[:-16].decode().split(':')
    parts[-1] = '1' if parts[-1] != '1' else '2'
    tampered = base64.urlsafe_b64encode(':'.join(parts).encode() + raw[-16:]).decode().rstrip('=')
    with pytest.raises(oauth.PagBankOAuthError):
        oauth.return_origin_for_state(tampered)


def test_legacy_in_flight_oauth_state_keeps_configured_return_origin():
    import base64, hmac, time
    from app.config import settings
    data = f'8:admin:{int(time.time())}:nonce'.encode()
    mac = hmac.digest(settings.SECRET_KEY.encode(), b'pagbank-connect:' + oauth.api_url().encode() + b':' + data, 'sha256')[:16]
    state = base64.urlsafe_b64encode(data + mac).decode().rstrip('=')
    assert oauth.decode_state(state, state) == (8, 'admin')
    assert oauth.return_origin_for_state(state) == settings.KOMA_PUBLIC_APP_URL


def test_forbidden_bank_response_is_not_retryable_or_exposed_as_raw_payload():
    provider = PagBankProvider('seller-token')
    provider._client.close()
    provider._client = httpx.Client(base_url=oauth.api_url(), transport=httpx.MockTransport(
        lambda req: httpx.Response(403, json={'message': 'ACCESS_DENIED', 'secret': 'must-not-escape'})))
    with pytest.raises(PagBankError) as denied:
        provider.get_payment('ORDE_test')
    assert denied.value.status_code == 403
    assert not denied.value.retryable
    assert 'liberação' in str(denied.value)
    assert 'must-not-escape' not in str(denied.value)
    provider._client.close()


@pytest.mark.parametrize('provider_code', ['ACCESS_DENIED', 'unsafe secret@example.test'])
def test_bank_failure_keeps_only_safe_code_and_request_reference(caplog, provider_code):
    provider = PagBankProvider('seller-token')
    provider._client.close()
    provider._client = httpx.Client(base_url=oauth.api_url(), transport=httpx.MockTransport(
        lambda req: httpx.Response(403, headers={'x-request-id': 'bank-request-123'}, json={
            'error_messages': [{'code': provider_code, 'description': 'private buyer@example.test'}],
            'access_token': 'never-log-token', 'customer': {'tax_id': 'never-log-document'}})))
    try:
        with pytest.raises(PagBankError) as denied:
            provider.get_payment('ORDE_test')
        output = str(denied.value) + caplog.text
        assert 'bank-request-123' in output
        assert ('ACCESS_DENIED' in output) == (provider_code == 'ACCESS_DENIED')
        for sensitive in ('secret@example.test', 'buyer@example.test', 'never-log-token', 'never-log-document'):
            assert sensitive not in output
        assert denied.value.status_code == 403 and not denied.value.retryable
    finally:
        provider._client.close()

@pytest.mark.parametrize('parameter,expected', [
    ('charges[0].payment_method.pix.expiration_date', 'charges[0].payment_method.pix.expiration_date'),
    ('customer.email', 'customer.email'),
    ('notification_urls[0]', 'notification_urls[0]'),
    ('customer.email:secret@example.test', 'unavailable'),
    ('customer.email\nAuthorization: Bearer private', 'unavailable'),
    ('secrets.access_token', 'unavailable'),
])
def test_pagbank_invalid_parameter_logging_is_strictly_sanitized(caplog, parameter, expected):
    provider = PagBankProvider('seller-token')
    provider._client.close()
    provider._client = httpx.Client(base_url=oauth.api_url(), transport=httpx.MockTransport(
        lambda req: httpx.Response(400, headers={'x-request-id': 'bank-40002-safe-id'}, json={
            'error_messages': [{
                'code': '40002', 'description': 'invalid_parameter: sensitive@example.test',
                'parameter_name': parameter,
            }],
            'customer': {'email': 'sensitive@example.test', 'tax_id': 'never-log-document'},
            'access_token': 'never-log-token',
        })))
    try:
        with pytest.raises(PagBankError) as rejected:
            provider.get_payment('ORDE_test')
        assert rejected.value.status_code == 400
        assert not rejected.value.retryable
        assert 'Código: 40002.' in str(rejected.value)
        assert 'bank-40002-safe-id' in str(rejected.value)
        assert 'provider_code=40002' in caplog.text
        assert 'provider_parameter=' + expected in caplog.text
        assert 'provider_request_id=bank-40002-safe-id' in caplog.text
        for secret in ('sensitive@example.test', 'never-log-document', 'never-log-token',
                       'Authorization: Bearer private', 'seller-token'):
            assert secret not in caplog.text + str(rejected.value)
    finally:
        provider._client.close()

def test_pagbank_pix_expiration_is_utc_rfc3339_seconds():
    received = []
    def handle(req):
        received.append(json.loads(req.content))
        return httpx.Response(201, json=snapshot())
    provider = PagBankProvider('seller-token')
    provider._client.close()
    provider._client = httpx.Client(base_url=oauth.api_url(), transport=httpx.MockTransport(handle))
    try:
        expiry = datetime.datetime(2026, 10, 22, 21, 23, 15, 987654,
                                   tzinfo=datetime.timezone(datetime.timedelta(hours=-3)))
        provider.create_pix(amount=Decimal('4.50'), marketplace_fee=Decimal(0),
            payer_email='buyer@example.test', payer_name='Buyer', payer_tax_id='12345678909',
            external_reference='intent-test', idempotency_key='unique-123',
            notification_url='https://api.example.test/payment-webhook', expires_at=expiry)
        value = received[0]['charges'][0]['payment_method']['pix']['expiration_date']
        assert value == '2026-10-23T00:23:15Z'
        assert received[0]['charges'][0]['amount']['value'] == 450
    finally:
        provider._client.close()


def test_pilot8_webhook_logs_deduplicated_candidate_count_without_tokens(monkeypatch, caplog):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.database import SessionLocal, current_restaurante_id
    from app.models import Restaurante, Usuario, RestaurantPaymentAccount

    rid = 8
    context = current_restaurante_id.set(rid)
    db = SessionLocal()
    try:
        if not db.query(Restaurante).filter_by(id=rid).first():
            db.add(Restaurante(id=rid, nome='Pilot 8 Store', plano='pro'))
            db.flush()
        if not db.query(Usuario).filter_by(id='admin-p8').first():
            db.add(Usuario(id='admin-p8', restaurante_id=rid, nome='Admin', email='admin-p8@koma.test',
                           senha_hash='unused', role='admin', cargo='admin', status='ativo'))
            db.flush()
        account = RestaurantPaymentAccount(
            id='acc-pg-pilot8-test',
            restaurante_id=rid,
            provider='pagbank',
            provider_environment='production',
            provider_user_id='ACCO_P8_TEST',
            status='active',
            access_token='pilot8-token',
            webhook_secret='pilot8-token',  # identical to access_token
        )
        db.add(account)
        db.commit()

        monkeypatch.setenv('PAGBANK_PRODUCTION_RESTAURANT_IDS', '8')
        monkeypatch.setenv('PAGBANK_PRODUCTION_OWNER_RECEIVER_PILOT8', 'true')
        monkeypatch.setenv('PAGBANK_PRODUCTION_APP_TOKEN', 'pilot8-app-token')
        # Without seller_ibanking_token: candidates are 'pilot8-token' and 'pilot8-app-token' -> count 2
        client = TestClient(app, base_url='https://testserver')
        raw = b'{"id":"ORDE_P8"}'
        res = client.post(
            f'/payments/webhooks/pagbank/{account.id}',
            content=raw,
            headers={'Content-Type': 'application/json', 'x-authenticity-token': 'bad-sig', 'x-product-origin': 'ORDER'},
        )
        assert res.status_code == 401
        assert 'PagBank webhook authentication rejected tenant=8' in caplog.text
        assert 'candidate_count=2' in caplog.text
        assert 'origin=ORDER' in caplog.text
        assert 'pilot8-token' not in caplog.text
        assert 'pilot8-app-token' not in caplog.text
    finally:
        db.rollback()
        db.query(RestaurantPaymentAccount).filter_by(id='acc-pg-pilot8-test').delete()
        db.commit()
        db.close()
        current_restaurante_id.reset(context)

