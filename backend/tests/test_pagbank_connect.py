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

        # 3. Valid signature in production -> processes successfully
        valid_sig = hashlib.sha256(b'seller-webhook-secret-token-' + raw_body).hexdigest()
        res = client.post(
            f'/payments/webhooks/pagbank/{account.id}',
            content=raw_body,
            headers={'Content-Type': 'application/json', 'x-authenticity-token': valid_sig},
        )
        assert res.status_code == 200
        assert res.json()['status'] == 'processed'

        # 4. Replay idempotency -> returns already_processed
        res = client.post(
            f'/payments/webhooks/pagbank/{account.id}',
            content=raw_body,
            headers={'Content-Type': 'application/json', 'x-authenticity-token': valid_sig},
        )
        assert res.status_code == 200
        assert res.json()['status'] == 'already_processed'

        # 5. Sandbox without signature -> pulls from provider API and reconciles
        monkeypatch.setenv('PAGBANK_ENV', 'sandbox')
        account.provider_environment = 'sandbox'
        # Create second order and comanda for sandbox missing header test
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


def test_cardapio_polling_reconciles_and_guards_against_premature_expiration(monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.database import SessionLocal, current_restaurante_id
    from app.models import Restaurante, Usuario, Comanda, CaixaTurno, OnlinePaymentIntent, RestaurantPaymentAccount, Item, Lancamento, Produto, Categoria, Pagamento
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
        monkeypatch.setattr(PagBankProvider, 'get_payment', lambda self, pid: fake_payment)

        client = TestClient(app, base_url='https://testserver')
        # Poll order status via public cardapio endpoint with idempotency_key as key query param
        res = client.get('/cardapio/pedidos/comanda-test-9943/status', params={'key': 'key-test-9943'})
        assert res.status_code == 200, res.text
        data = res.json()

        # Crucial: order must NOT be cancelled/expired! It must be confirmed/pendente and payment approved!
        assert data['status'] != 'cancelado'
        assert data['pagamento']['status'] == 'approved'
        assert data['state']['terminal'] is False
        assert data['state']['rejected'] is False

        db.refresh(comanda)
        db.refresh(intent)
        assert comanda.fechada is False
        assert comanda.online_payment_status == 'approved'
        assert intent.status == 'approved'

    finally:
        db.rollback()
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

