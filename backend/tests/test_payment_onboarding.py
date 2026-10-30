"""Isolated payment onboarding regressions; no bank requests or production writes."""
import datetime as dt

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine

from app.database import Base, SessionLocal, current_restaurante_id
from app.models import (
    Restaurante, Usuario, RestaurantPaymentAccount, RestaurantDirectPixConfig,
    OnlinePaymentIntent, CaixaTurno, Comanda,
)
from app.routes import pagbank_payments, online_payments
from app.services.online_payments import account_connection as connection
from app.services.online_payments.service import OnlinePaymentService
from app.config import settings
from app.services.online_payments.oauth import MercadoPagoOAuthTokens
from app.services.online_payments.pagbank import oauth

A, B = 99581, 99582


@pytest.fixture
def onboarding_db(monkeypatch):
    monkeypatch.setattr(settings, 'KOMA_PUBLIC_API_URL', 'https://api.example.test')
    monkeypatch.setattr(settings, 'MERCADO_PAGO_MARKETPLACE_USER_ID', '')
    monkeypatch.setenv('PAGBANK_ENV', 'sandbox')
    monkeypatch.delenv('PAGBANK_PRODUCTION_RESTAURANT_IDS', raising=False)
    engine = create_engine('sqlite://')
    Base.metadata.create_all(engine)
    db = SessionLocal(bind=engine)
    context = current_restaurante_id.set(None)
    for rid in (A, B):
        db.add(Restaurante(id=rid, nome=f'Isolated onboarding {rid}', plano='pro',
                          formas_pagamento_aceitas=['Dinheiro', 'Cartão de débito']))
        db.flush()
        db.add(Usuario(id=f'onboarding-admin-{rid}', restaurante_id=rid, nome='Admin',
                       email=f'onboarding-{rid}@example.test', senha_hash='unused',
                       role='admin', cargo='admin', status='ativo'))
    db.commit()
    try:
        yield db
    finally:
        db.close()
        current_restaurante_id.reset(context)
        engine.dispose()


def _account(db, rid=A, provider='pagbank', status='active'):
    account = RestaurantPaymentAccount(id=f'onboarding-{rid}-{provider}', restaurante_id=rid,
        provider=provider, provider_environment='sandbox' if provider == 'pagbank' else None,
        provider_user_id=f'isolated-seller-{rid}-{provider}', status=status)
    account.access_token = f'isolated-token-{rid}-{provider}'
    account.webhook_secret = 'isolated-webhook-secret'
    account.refresh_token = 'isolated-refresh'
    db.add(account)
    db.commit()
    return account


def _pending(db, account):
    shift = CaixaTurno(restaurante_id=A, aberto_por_id=f'onboarding-admin-{A}', status='aberto', saldo_inicial=0)
    db.add(shift)
    db.flush()
    order = Comanda(id='onboarding-pending-order', restaurante_id=A, garcom_id=f'onboarding-admin-{A}',
                    numero_pedido=1, tipo='Delivery', online_payment_status='pending')
    db.add(order)
    db.flush()
    db.add(OnlinePaymentIntent(id='onboarding-pending-intent', restaurante_id=A,
        comanda_id=order.id, turno_id=shift.id, provider=account.provider, method='pix', status='pending',
        amount=6, marketplace_fee=0, fee_settlement='none', idempotency_key='isolated-onboarding-key',
        external_payment_id='ORDE_isolated_onboarding'))
    db.commit()


@pytest.mark.parametrize('methods, expected', [
    (None, ['Dinheiro', 'Pix']),
    (['Dinheiro', 'Cartão de débito'], ['Dinheiro', 'Cartão de débito', 'Pix']),
    ('["Dinheiro", "Cartão de crédito"]', ['Dinheiro', 'Cartão de crédito', 'Pix']),
    (['Pix', 'Dinheiro'], ['Pix', 'Dinheiro']),
    ([], ['Pix']),
])
def test_connection_enables_pix_without_removing_payment_choices(onboarding_db, methods, expected):
    db = onboarding_db
    restaurant = db.get(Restaurante, A)
    restaurant.formas_pagamento_aceitas = methods
    db.commit()
    connection.enable_menu_pix(db, restaurant_id=A)
    db.commit()
    assert db.get(Restaurante, A).formas_pagamento_aceitas == expected
    assert db.get(Restaurante, B).formas_pagamento_aceitas == ['Dinheiro', 'Cartão de débito']
    connection.enable_menu_pix(db, restaurant_id=A)
    db.commit()
    assert db.get(Restaurante, A).formas_pagamento_aceitas == expected


@pytest.mark.parametrize('existing, requested', [('pagbank', 'mercado_pago'), ('mercado_pago', 'pagbank')])
def test_second_bank_is_rejected_and_first_credentials_preserved(onboarding_db, existing, requested):
    db = onboarding_db
    account = _account(db, provider=existing)
    previous = account.access_token
    with pytest.raises(connection.MercadoPagoAccountConnectionError, match='Desconecte'):
        connection.ensure_receiver_available(db, restaurant_id=A, provider=requested)
    db.rollback()
    assert account.status == 'active'
    assert account.access_token == previous
    assert db.query(RestaurantPaymentAccount).filter_by(restaurante_id=A).count() == 1


@pytest.mark.parametrize('requested', ['pagbank', 'mercado_pago'])
def test_direct_pix_also_blocks_second_receiver(onboarding_db, requested):
    db = onboarding_db
    db.add(RestaurantDirectPixConfig(restaurante_id=A, enabled=True, key_type='email',
        pix_key='isolated@example.test', holder_name='TEST', city='FORTALEZA',
        accepted_by=f'onboarding-admin-{A}', accepted_at=dt.datetime.now(dt.timezone.utc),
        terms_version='direct-pix-v1'))
    db.commit()
    with pytest.raises(connection.MercadoPagoAccountConnectionError, match='Desconecte'):
        connection.ensure_receiver_available(db, restaurant_id=A, provider=requested)
    db.rollback()
    assert db.get(RestaurantDirectPixConfig, A).enabled is True


@pytest.mark.parametrize('status', ['disconnected', 'error'])
def test_inactive_bank_does_not_block_new_receiver(onboarding_db, status):
    _account(onboarding_db, provider='mercado_pago', status=status)
    connection.ensure_receiver_available(onboarding_db, restaurant_id=A, provider='pagbank')


def test_other_restaurant_receiver_does_not_block_connection(onboarding_db):
    _account(onboarding_db, rid=B, provider='mercado_pago')
    connection.ensure_receiver_available(onboarding_db, restaurant_id=A, provider='pagbank')


def test_same_seller_reconnect_keeps_pending_pix_and_original_receiver(onboarding_db):
    db = onboarding_db
    account = _account(db)
    _pending(db, account)
    connection.guard_receiver_change(db, restaurant_id=A, provider='pagbank',
        provider_user_id=account.provider_user_id, environment='sandbox')
    assert db.get(OnlinePaymentIntent, 'onboarding-pending-intent').status == 'pending'
    assert account.status == 'active'


def test_second_bank_completion_cannot_silently_replace_existing_bank(onboarding_db, monkeypatch):
    db = onboarding_db
    previous = _account(db, provider='mercado_pago')
    user = db.get(Usuario, f'onboarding-admin-{A}')
    monkeypatch.setattr(pagbank_payments, 'require_tenant_id', lambda: A)
    monkeypatch.setattr(oauth, 'decode_state', lambda *_: (A, user.id))
    monkeypatch.setattr(oauth, 'exchange', lambda *a, **kw: MercadoPagoOAuthTokens(
        'new-bank-token', 'new-bank-refresh', None, 'new-bank-seller', 3600))
    monkeypatch.setattr(oauth, 'owner_receiver_blocked', lambda *a, **kw: False)
    with pytest.raises(HTTPException) as denied:
        pagbank_payments.complete(pagbank_payments.AuthorizationCompletion(code='isolated', state='isolated'), db=db, user=user)
    assert denied.value.status_code == 409
    assert previous.status == 'active'
    assert previous.access_token == f'isolated-token-{A}-mercado_pago'
    assert db.query(RestaurantPaymentAccount).filter_by(restaurante_id=A, provider='pagbank').count() == 0
    assert db.get(Restaurante, A).formas_pagamento_aceitas == ['Dinheiro', 'Cartão de débito']


def test_failed_oauth_keeps_existing_menu_and_receiver(onboarding_db, monkeypatch):
    db = onboarding_db
    account = _account(db)
    user = db.get(Usuario, f'onboarding-admin-{A}')
    monkeypatch.setattr(pagbank_payments, 'require_tenant_id', lambda: A)
    monkeypatch.setattr(oauth, 'decode_state', lambda *_: (A, user.id))
    def reject(*args, **kwargs):
        raise oauth.PagBankOAuthError('Unavailable', reason='41012')
    monkeypatch.setattr(oauth, 'exchange', reject)
    with pytest.raises(HTTPException) as denied:
        pagbank_payments.complete(pagbank_payments.AuthorizationCompletion(code='isolated', state='isolated'), db=db, user=user)
    assert denied.value.status_code == 503
    assert account.status == 'active'
    assert account.access_token == f'isolated-token-{A}-pagbank'
    assert db.get(Restaurante, A).formas_pagamento_aceitas == ['Dinheiro', 'Cartão de débito']


@pytest.mark.parametrize('provider', ['pagbank', 'mercado_pago'])
def test_status_blocks_only_competing_bank(onboarding_db, provider):
    db = onboarding_db
    _account(db, provider=provider)
    other = 'mercado_pago' if provider == 'pagbank' else 'pagbank'
    own = connection.receiver_connection_status(db, restaurant_id=A, provider=provider)
    competing = connection.receiver_connection_status(db, restaurant_id=A, provider=other)
    assert own['receiver_provider'] == provider
    assert own['connection_blocked'] is False
    assert competing['receiver_provider'] == provider
    assert competing['connection_blocked'] is True
    separate = connection.receiver_connection_status(db, restaurant_id=B, provider=other)
    assert separate['receiver_provider'] is None
    assert separate['connection_blocked'] is False


def test_successful_pagbank_callback_activates_menu_for_current_restaurant_only(onboarding_db, monkeypatch):
    db = onboarding_db
    user = db.get(Usuario, f'onboarding-admin-{A}')
    monkeypatch.setattr(pagbank_payments, 'require_tenant_id', lambda: A)
    monkeypatch.setattr(oauth, 'decode_state', lambda *_: (A, user.id))
    monkeypatch.setattr(oauth, 'exchange', lambda *a, **kw: MercadoPagoOAuthTokens(
        'new-bank-token', 'new-bank-refresh', None, 'new-bank-seller', 3600))
    monkeypatch.setattr(oauth, 'owner_receiver_blocked', lambda *a, **kw: False)
    response = pagbank_payments.complete(
        pagbank_payments.AuthorizationCompletion(code='isolated', state='isolated'), db=db, user=user)
    assert response['status'] == 'connected'
    assert db.get(Restaurante, A).formas_pagamento_aceitas == ['Dinheiro', 'Cartão de débito', 'Pix']
    assert db.get(Restaurante, B).formas_pagamento_aceitas == ['Dinheiro', 'Cartão de débito']


def test_successful_mp_account_activation_also_enables_menu(onboarding_db):
    db = onboarding_db
    account = connection.upsert_mercado_pago_account(db, restaurant_id=A,
        tokens=MercadoPagoOAuthTokens('mp-token', 'mp-refresh', None, 'mp-new-seller', 3600),
        webhook_secret='mp-isolated-secret')
    db.commit()
    assert account.status == 'active'
    assert db.get(Restaurante, A).formas_pagamento_aceitas == ['Dinheiro', 'Cartão de débito', 'Pix']
    assert db.get(Restaurante, B).formas_pagamento_aceitas == ['Dinheiro', 'Cartão de débito']


@pytest.mark.parametrize('intent_status', ['created', 'pending', 'error'])
def test_mp_disconnect_rejects_uncertain_payments_without_changing_other_tenant(onboarding_db, monkeypatch, intent_status):
    db = onboarding_db
    account = _account(db, provider='mercado_pago')
    other = _account(db, rid=B, provider='mercado_pago')
    _pending(db, account)
    db.get(OnlinePaymentIntent, 'onboarding-pending-intent').status = intent_status
    db.commit()
    monkeypatch.setattr(online_payments, 'require_tenant_id', lambda: A)
    with pytest.raises(HTTPException) as denied:
        online_payments.mercado_pago_disconnect(db=db, current_user=db.get(Usuario, f'onboarding-admin-{A}'))
    assert denied.value.status_code == 409
    db.rollback()
    assert account.status == other.status == 'active'
    assert account.access_token == f'isolated-token-{A}-mercado_pago'


def test_mp_disconnect_preserves_historical_account_credentials_and_other_tenant(onboarding_db, monkeypatch):
    db = onboarding_db
    account = _account(db, provider='mercado_pago')
    other = _account(db, rid=B, provider='mercado_pago')
    _pending(db, account)
    intent = db.get(OnlinePaymentIntent, 'onboarding-pending-intent')
    intent.status = 'approved'
    db.commit()
    monkeypatch.setattr(online_payments, 'require_tenant_id', lambda: A)
    response = online_payments.mercado_pago_disconnect(db=db, current_user=db.get(Usuario, f'onboarding-admin-{A}'))
    assert response == {'status': 'disconnected'}
    assert account.status == 'disconnected'
    assert other.status == 'active'
    assert account.access_token == f'isolated-token-{A}-mercado_pago'
    assert account.refresh_token == 'isolated-refresh'
    assert OnlinePaymentService.account_for_intent(db, intent).id == account.id
    assert OnlinePaymentService.public_payment_capabilities(db, A) == (False, False)
    assert OnlinePaymentService.public_payment_capabilities(db, B) == (True, False)


@pytest.mark.parametrize('provider, missing', [('pagbank', '_access_token'), ('mercado_pago', '_access_token'), ('mercado_pago', '_webhook_secret')])
def test_public_menu_does_not_advertise_account_missing_required_credentials(onboarding_db, provider, missing):
    db = onboarding_db
    account = _account(db, provider=provider)
    setattr(account, missing, '')
    db.commit()
    assert OnlinePaymentService.public_payment_capabilities(db, A) == (False, False)


def test_public_menu_does_not_advertise_marketplace_owner_account(onboarding_db, monkeypatch):
    db = onboarding_db
    account = _account(db, provider='mercado_pago')
    monkeypatch.setattr(settings, 'MERCADO_PAGO_MARKETPLACE_USER_ID', account.provider_user_id)
    assert OnlinePaymentService.public_payment_capabilities(db, A) == (False, False)


@pytest.fixture
def onboarding_postgres(monkeypatch):
    """Optional dedicated localhost database, never configured production URLs."""
    import os
    from sqlalchemy.engine import make_url
    database_url = os.environ.get('PAYMENT_ONBOARDING_TEST_DATABASE_URL', '')
    if not database_url:
        pytest.skip('Dedicated localhost payment onboarding PostgreSQL not configured')
    url = make_url(database_url)
    if url.host not in {'127.0.0.1', 'localhost'} or url.database != 'koma_payment_onboarding_test':
        raise RuntimeError('Payment onboarding concurrency requires dedicated localhost test database')
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    db = SessionLocal(bind=engine)
    context = current_restaurante_id.set(None)
    db.add(Restaurante(id=A, nome='Isolated concurrent onboarding', plano='pro', formas_pagamento_aceitas=['Dinheiro']))
    db.flush()
    db.add(Usuario(id=f'onboarding-admin-{A}', restaurante_id=A, nome='Admin',
        email=f'onboarding-{A}@example.test', senha_hash='unused', role='admin', cargo='admin', status='ativo'))
    db.commit()
    db.close()
    monkeypatch.setenv('PAGBANK_ENV', 'sandbox')
    monkeypatch.delenv('PAGBANK_PRODUCTION_RESTAURANT_IDS', raising=False)
    monkeypatch.setattr(settings, 'MERCADO_PAGO_MARKETPLACE_USER_ID', '')
    try:
        yield engine
    finally:
        current_restaurante_id.reset(context)
        Base.metadata.drop_all(engine)
        engine.dispose()


@pytest.mark.parametrize('attempt', range(4))
def test_concurrent_bank_callbacks_commit_exactly_one_receiver(onboarding_postgres, monkeypatch, attempt):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from app.services.online_payments.oauth import MercadoPagoOAuthState
    engine = onboarding_postgres
    barrier = Barrier(2)
    uid = f'onboarding-admin-{A}'
    monkeypatch.setattr(pagbank_payments, 'require_tenant_id', lambda: A)
    monkeypatch.setattr(oauth, 'decode_state', lambda *_: (A, uid))
    monkeypatch.setattr(oauth, 'exchange', lambda *a, **kw: MercadoPagoOAuthTokens(
        'concurrent-pagbank-token', 'refresh-pagbank', None, f'concurrent-pagbank-{attempt}', 3600))
    monkeypatch.setattr(oauth, 'owner_receiver_blocked', lambda *a, **kw: False)
    monkeypatch.setattr(online_payments, 'exchange_authorization_code', lambda **kw: (
        MercadoPagoOAuthState(A, uid, 'isolated-verifier', 0),
        MercadoPagoOAuthTokens('concurrent-mp-token', 'refresh-mp', None, f'concurrent-mp-{attempt}', 3600)))
    monkeypatch.setattr(connection, 'configured_webhook_secret', lambda: 'isolated-mp-webhook')

    def complete(provider):
        db = SessionLocal(bind=engine)
        context = current_restaurante_id.set(None)
        try:
            user = db.get(Usuario, uid)
            barrier.wait(timeout=10)
            if provider == 'pagbank':
                response = pagbank_payments.complete(
                    pagbank_payments.AuthorizationCompletion(code='isolated', state='isolated'), db=db, user=user)
                return provider, response['status'] == 'connected'
            response = online_payments.mercado_pago_oauth_callback(code='isolated', state='isolated', db=db)
            return provider, response.status_code == 303
        except HTTPException as exc:
            assert exc.status_code in {409, 503}
            db.rollback()
            return provider, False
        finally:
            db.close()
            current_restaurante_id.reset(context)

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(complete, ('pagbank', 'mercado_pago')))
    assert sum(success for _, success in outcomes) == 1
    db = SessionLocal(bind=engine)
    try:
        active = db.query(RestaurantPaymentAccount).filter_by(restaurante_id=A, status='active').all()
        assert len(active) == 1
        assert active[0].provider == next(provider for provider, success in outcomes if success)
        assert db.query(RestaurantPaymentAccount).filter_by(restaurante_id=A).count() == 1
        assert db.get(Restaurante, A).formas_pagamento_aceitas == ['Dinheiro', 'Pix']
    finally:
        db.close()


@pytest.mark.parametrize('intent_status', ['created', 'pending', 'error'])
def test_pagbank_disconnect_rejects_uncertain_payments_without_changing_receiver(onboarding_db, monkeypatch, intent_status):
    db = onboarding_db
    account = _account(db, provider='pagbank')
    other = _account(db, rid=B, provider='pagbank')
    _pending(db, account)
    db.get(OnlinePaymentIntent, 'onboarding-pending-intent').status = intent_status
    db.commit()
    monkeypatch.setattr(pagbank_payments, 'require_tenant_id', lambda: A)
    monkeypatch.setattr(oauth, 'revoke', lambda *args, **kwargs: pytest.fail('Disconnect must not revoke historical access'))
    with pytest.raises(HTTPException) as denied:
        pagbank_payments.disconnect(db=db, user=db.get(Usuario, f'onboarding-admin-{A}'))
    assert denied.value.status_code == 409
    db.rollback()
    assert account.status == other.status == 'active'
    assert account.access_token == f'isolated-token-{A}-pagbank'
    assert account.refresh_token == 'isolated-refresh'


def test_pagbank_disconnect_then_mp_connect_preserves_original_paid_intent_credentials(onboarding_db, monkeypatch):
    db = onboarding_db
    account = _account(db, provider='pagbank')
    other = _account(db, rid=B, provider='pagbank')
    _pending(db, account)
    intent = db.get(OnlinePaymentIntent, 'onboarding-pending-intent')
    intent.status = 'approved'
    db.commit()
    original_credentials = (account.access_token, account.refresh_token, account.webhook_secret,
                            account.provider_user_id, account.provider_environment)
    monkeypatch.setattr(pagbank_payments, 'require_tenant_id', lambda: A)
    monkeypatch.setattr(oauth, 'revoke', lambda *args, **kwargs: pytest.fail('Disconnect must not revoke historical access'))
    result = pagbank_payments.disconnect(db=db, user=db.get(Usuario, f'onboarding-admin-{A}'))
    assert result == {'status': 'disconnected'}
    assert account.status == 'disconnected'
    new_account = connection.upsert_mercado_pago_account(db, restaurant_id=A,
        tokens=MercadoPagoOAuthTokens('replacement-mp-token', 'replacement-mp-refresh', None, 'replacement-mp-seller', 3600),
        webhook_secret='replacement-mp-webhook')
    db.commit()
    original = OnlinePaymentService.account_for_intent(db, intent)
    assert original.id == account.id
    assert (original.access_token, original.refresh_token, original.webhook_secret,
            original.provider_user_id, original.provider_environment) == original_credentials
    assert original.status == 'disconnected'
    assert new_account.status == 'active'
    assert other.status == 'active'
    assert db.query(RestaurantPaymentAccount).filter_by(restaurante_id=A, status='active').count() == 1
