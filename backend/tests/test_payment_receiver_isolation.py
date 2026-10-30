"""Internal fixtures only: these are NOT bank/homologation evidence."""
import datetime as dt
import hashlib
import json
from decimal import Decimal

import httpx
import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm.exc import NoResultFound

from app.config import settings
from app.database import Base, SessionLocal, current_restaurante_id
from app.models import (Restaurante, Usuario, CaixaTurno, Comanda, OnlinePaymentIntent,
                        RestaurantPaymentAccount, RestaurantDirectPixConfig)
from app.services.online_payments.account_connection import (guard_receiver_change,
    upsert_mercado_pago_account, MercadoPagoAccountConnectionError)
from app.services.online_payments.oauth import MercadoPagoOAuthTokens
from app.services.online_payments.pagbank import oauth
from app.services.online_payments.provider_registry import provider_for_account
from app.services.online_payments.base import ProviderPayment
from app.services.online_payments.service import OnlinePaymentService, OnlinePaymentConfigurationError
from app.routes import pagbank_payments

A, B = 99571, 99572


@pytest.fixture
def db(monkeypatch):
    monkeypatch.setattr(settings, "KOMA_PUBLIC_API_URL", "https://api.example.test")
    monkeypatch.setenv("PAGBANK_ENV", "sandbox")
    monkeypatch.delenv("PAGBANK_PRODUCTION_RESTAURANT_IDS", raising=False)
    engine = create_engine('sqlite://')
    Base.metadata.create_all(engine)
    session = SessionLocal(bind=engine)
    ctx = current_restaurante_id.set(None)
    for rid in (A, B):
        session.add(Restaurante(id=rid, nome=f'Internal tenant {rid}', plano='pro'))
        session.flush()
        user = Usuario(id=f'admin-{rid}', restaurante_id=rid, nome='Test admin', email=f'{rid}@example.test',
                       senha_hash='unused', role='admin', cargo='admin', status='ativo')
        session.add(user)
        session.flush()
        shift = CaixaTurno(restaurante_id=rid, aberto_por_id=user.id, status='aberto', saldo_inicial=0)
        session.add(shift)
        session.flush()
        order = Comanda(id=f'order-{rid}', restaurante_id=rid, garcom_id=user.id, numero_pedido=rid,
                        tipo='Consumo no Local', online_payment_status='pending')
        session.add(order)
        session.flush()
        account = RestaurantPaymentAccount(id=f'account-{rid}', restaurante_id=rid, provider='pagbank',
                    provider_environment='sandbox', provider_user_id=f'ACCO_{rid}', status='active')
        account.access_token = f'internal-seller-token-{rid}'
        account.webhook_secret = account.access_token
        account.refresh_token = f'internal-refresh-{rid}'
        session.add(account)
        session.add(OnlinePaymentIntent(id=f'intent-{rid}', restaurante_id=rid, comanda_id=order.id,
                    turno_id=shift.id, provider='pagbank', method='pix', status='pending', amount=4.50,
                    marketplace_fee=0, fee_settlement='none', idempotency_key=f'key-{rid}',
                    external_payment_id=f'ORDE_{rid}'))
    session.commit()
    try:
        yield session
    finally:
        session.close()
        current_restaurante_id.reset(ctx)
        engine.dispose()


def account(db, rid):
    return db.query(RestaurantPaymentAccount).filter_by(restaurante_id=rid, provider='pagbank').one()


def intent(db, rid):
    return db.query(OnlinePaymentIntent).filter_by(restaurante_id=rid).one()


def direct(db, rid):
    row = RestaurantDirectPixConfig(restaurante_id=rid, enabled=True, key_type='email', pix_key='test@example.test',
             holder_name='TEST', city='FORTALEZA', accepted_by=f'admin-{rid}',
             accepted_at=dt.datetime.now(dt.timezone.utc), terms_version='direct-pix-v1')
    db.add(row)
    db.flush()
    return row


def test_each_restaurant_sends_only_its_seller_token_and_environment(db, monkeypatch):
    requests = []
    def handle(req):
        requests.append(req)
        rid = A if req.headers['Authorization'].endswith(str(A)) else B
        return httpx.Response(200, json={'id': f'ORDE_{rid}', 'reference_id': f'intent-{rid}', 'charges': [{
            'status': 'WAITING', 'payment_method': {'type': 'PIX'}, 'amount': {'value': 450, 'currency': 'BRL'}}]})
    for rid in (A, B):
        adapter = provider_for_account(account(db, rid))
        original = adapter._client
        adapter._client = httpx.Client(base_url=str(original.base_url), headers=original.headers,
                                       transport=httpx.MockTransport(handle))
        original.close()
        try:
            assert adapter.get_payment(f'ORDE_{rid}').external_reference == f'intent-{rid}'
        finally:
            adapter._client.close()
    assert [req.headers['Authorization'] for req in requests] == [f'Bearer internal-seller-token-{A}', f'Bearer internal-seller-token-{B}']
    assert all(req.url.host == 'sandbox.api.pagseguro.com' for req in requests)


def test_cross_tenant_snapshot_cannot_approve_other_order(db):
    payment = ProviderPayment(f'ORDE_{B}', 'approved', Decimal('4.50'), f'intent-{B}')
    with pytest.raises(NoResultFound):
        OnlinePaymentService.apply_provider_snapshot_in_session(db, account=account(db, A), intent=intent(db, B), payment=payment)
    assert intent(db, B).status == 'pending'


def test_cross_tenant_webhook_rejected_before_querying_bank(db, monkeypatch):
    monkeypatch.setattr(pagbank_payments, '_resolve_account_tenant', lambda *_: A)
    monkeypatch.setattr(OnlinePaymentService, 'reconcile_provider_payment', lambda *a, **kw: pytest.fail('Cross-tenant bank lookup'))
    raw = json.dumps({'id': f'ORDE_{B}'}).encode()
    for signing_rid, expected in ((B, 401), (A, 503)):
        signature = hashlib.sha256(f'internal-seller-token-{signing_rid}-'.encode() + raw).hexdigest()
        with pytest.raises(HTTPException) as denied:
            pagbank_payments._process_webhook(f'account-{A}', f'ORDE_{B}', raw, signature, BackgroundTasks(), db)
        assert denied.value.status_code == expected
    assert intent(db, B).status == 'pending'


def test_same_seller_cannot_be_bound_to_two_restaurants(db):
    account(db, B).provider_user_id = account(db, A).provider_user_id
    with pytest.raises(IntegrityError):
        db.flush()
    db.rollback()
    assert account(db, A).provider_user_id != account(db, B).provider_user_id


@pytest.mark.parametrize('target', ['mercado_pago', 'direct_pix'])
def test_pending_receiver_switch_rejected_without_changing_other_tenant(db, target):
    with pytest.raises(MercadoPagoAccountConnectionError, match='Desconecte'):
        guard_receiver_change(db, restaurant_id=A, provider=target, provider_user_id='new-seller')
    assert account(db, A).status == account(db, B).status == 'active'
    assert intent(db, A).status == intent(db, B).status == 'pending'


def test_ambiguous_direct_and_bank_never_selects_arbitrary_receiver(db, monkeypatch):
    monkeypatch.setattr(settings, 'DIRECT_PIX_ENABLED', True)
    direct(db, A)
    assert OnlinePaymentService.public_payment_capabilities(db, A) == (False, False)
    with pytest.raises(OnlinePaymentConfigurationError, match='mais de um'):
        OnlinePaymentService.active_account(db, A)
    assert OnlinePaymentService.active_account(db, B).provider_user_id == f'ACCO_{B}'


def test_switch_keeps_original_account_and_history_for_reconciliation(db):
    old = intent(db, A)
    old.status = 'approved'
    db.commit()
    original_token = account(db, A).access_token
    # Explicitly disconnect before switching; preserve the original credentials
    # for the historical intent instead of silently replacing its receiver.
    account(db, A).status = 'disconnected'
    db.commit()
    upsert_mercado_pago_account(db, restaurant_id=A,
        tokens=MercadoPagoOAuthTokens('new-mp-token', 'new-mp-refresh', None, 'mp-seller-A', 3600), webhook_secret='mp-hook')
    db.commit()
    assert account(db, A).status == 'disconnected'
    assert OnlinePaymentService.account_for_intent(db, old).access_token == original_token
    assert old.provider == 'pagbank' and old.external_payment_id == f'ORDE_{A}'
    assert account(db, B).status == 'active'
    assert db.query(RestaurantPaymentAccount).filter_by(restaurante_id=A, status='active').count() == 1


@pytest.mark.parametrize('seller,environment', [('different-seller', 'sandbox'), (f'ACCO_{A}', 'production')])
def test_historical_credentials_cannot_be_overwritten(db, seller, environment):
    intent(db, A).status = 'approved'
    db.commit()
    with pytest.raises(MercadoPagoAccountConnectionError, match='histórico'):
        guard_receiver_change(db, restaurant_id=A, provider='pagbank', provider_user_id=seller, environment=environment)
    assert account(db, A).provider_environment == 'sandbox'
    assert account(db, A).access_token == f'internal-seller-token-{A}'


def test_verified_owner_guard_is_environment_scoped_and_blocks_new_charges(db, monkeypatch):
    monkeypatch.setenv('PAGBANK_ENV', 'sandbox')
    monkeypatch.setenv('PAGBANK_APPLICATION_OWNER_ACCOUNT_ID', f'ACCO_{A}')
    monkeypatch.setenv('PAGBANK_PRODUCTION_APPLICATION_OWNER_ACCOUNT_ID', f'ACCO_{B}')
    assert OnlinePaymentService.public_payment_capabilities(db, A) == (False, False)
    assert OnlinePaymentService.public_payment_capabilities(db, B) == (True, True)
    assert oauth.is_application_owner(f'ACCO_{A}', environment='sandbox')
    assert not oauth.is_application_owner(f'ACCO_{A}', environment='production')
    with pytest.raises(OnlinePaymentConfigurationError, match='proprietária'):
        OnlinePaymentService.active_account(db, A)
    assert OnlinePaymentService.active_account(db, B).provider_user_id == f'ACCO_{B}'


def test_wrong_environment_does_not_hide_receiver_ambiguity(db, monkeypatch):
    monkeypatch.setattr(settings, "DIRECT_PIX_ENABLED", True)
    account(db, A).provider_environment = 'production'
    direct(db, A)
    db.flush()
    assert OnlinePaymentService.public_payment_capabilities(db, A) == (False, False)


def test_owner_oauth_completion_is_rejected_before_account_mutation(db, monkeypatch):
    from app.services.online_payments.oauth import MercadoPagoOAuthTokens
    user = db.query(Usuario).filter_by(restaurante_id=A).one()
    monkeypatch.setattr(pagbank_payments, 'require_tenant_id', lambda: A)
    monkeypatch.setattr(oauth, 'decode_state', lambda *_: (A, user.id))
    monkeypatch.setattr(oauth, 'exchange', lambda *a, **kw: MercadoPagoOAuthTokens(
        'owner-token', None, None, 'verified-owner', 3600))
    monkeypatch.setenv('PAGBANK_APPLICATION_OWNER_ACCOUNT_ID', 'verified-owner')
    previous = account(db, A).access_token
    with pytest.raises(HTTPException) as denied:
        pagbank_payments.complete(pagbank_payments.AuthorizationCompletion(code='internal', state='internal'), db=db, user=user)
    assert denied.value.status_code == 409
    assert account(db, A).access_token == previous
    assert account(db, B).access_token == f'internal-seller-token-{B}'


def test_pilot8_owner_receiver_exception_matrix(db, monkeypatch):
    """Test all facets of owner receiver pilot 8 exception:
    1. Without opt-in, owner is blocked on restaurant 8 in production.
    2. With opt-in, owner is permitted ONLY on restaurant 8 in production.
    3. Restaurant 8 in sandbox remains blocked even with opt-in.
    4. Other restaurants (e.g. 6, 7, 9, A) remain blocked in production and sandbox.
    5. Connection status, public capabilities, active_account, and complete agree.
    """
    rid = 8
    owner_acco = 'ACCO_PAGBANK_OWNER_PROD'
    monkeypatch.setenv('PAGBANK_ENV', 'sandbox')
    monkeypatch.setenv('PAGBANK_PRODUCTION_APPLICATION_OWNER_ACCOUNT_ID', owner_acco)

    # Setup restaurant 8 in db
    r8 = db.query(Restaurante).filter_by(id=rid).first()
    if not r8:
        db.add(Restaurante(id=rid, nome='D8 Burger', plano='pro'))
        db.flush()
    u8 = db.query(Usuario).filter_by(restaurante_id=rid).first()
    if not u8:
        u8 = Usuario(id=f'admin-{rid}', restaurante_id=rid, nome='D8 Admin', email='d8@example.test',
                     senha_hash='unused', role='admin', cargo='admin', status='ativo')
        db.add(u8)
        db.flush()
    s8 = db.query(CaixaTurno).filter_by(restaurante_id=rid).first()
    if not s8:
        s8 = CaixaTurno(restaurante_id=rid, aberto_por_id=u8.id, status='aberto', saldo_inicial=0)
        db.add(s8)
        db.flush()
    acc8 = db.query(RestaurantPaymentAccount).filter_by(restaurante_id=rid, provider='pagbank').first()
    if not acc8:
        acc8 = RestaurantPaymentAccount(
            id=f'account-{rid}', restaurante_id=rid, provider='pagbank',
            provider_environment='production', provider_user_id=owner_acco, status='active',
        )
        acc8.access_token = 'seller-token-pilot8'
        acc8.webhook_secret = acc8.access_token
        acc8.refresh_token = 'refresh-pilot8'
        db.add(acc8)
        db.flush()
    else:
        acc8.provider_environment = 'production'
        acc8.provider_user_id = owner_acco
        acc8.status = 'active'
        acc8.access_token = 'seller-token-pilot8'
        db.flush()
    db.commit()

    # Case 1: Restaurant 8 in production without opt-in flag -> BLOCKED
    monkeypatch.setenv('PAGBANK_PRODUCTION_RESTAURANT_IDS', '8')
    monkeypatch.delenv('PAGBANK_PRODUCTION_OWNER_RECEIVER_PILOT8', raising=False)

    monkeypatch.setattr(pagbank_payments, 'require_tenant_id', lambda: rid)
    st = pagbank_payments.connection_status(db=db, user=u8)
    assert st['connected'] is False
    assert OnlinePaymentService.public_payment_capabilities(db, rid) == (False, False)
    with pytest.raises(OnlinePaymentConfigurationError, match='proprietária'):
        OnlinePaymentService.active_account(db, rid)

    # Case 2: Restaurant 8 in production WITH opt-in flag -> PERMITTED
    monkeypatch.setenv('PAGBANK_PRODUCTION_OWNER_RECEIVER_PILOT8', 'true')

    st = pagbank_payments.connection_status(db=db, user=u8)
    assert st['connected'] is True
    assert st['environment'] == 'production'
    assert OnlinePaymentService.public_payment_capabilities(db, rid) == (True, True)
    active = OnlinePaymentService.active_account(db, rid)
    assert active.provider_user_id == owner_acco
    assert active.access_token == 'seller-token-pilot8'

    # Verify oauth.complete allows connection for restaurant 8 with opt-in
    monkeypatch.setattr(oauth, 'decode_state', lambda *_: (rid, u8.id))
    monkeypatch.setattr(oauth, 'exchange', lambda *a, **kw: MercadoPagoOAuthTokens(
        'new-seller-token-8', 'new-refresh-8', None, owner_acco, 3600))
    pagbank_payments.complete(
        pagbank_payments.AuthorizationCompletion(code='valid-code', state='valid-state'),
        db=db, user=u8,
    )
    assert account(db, rid).access_token == 'new-seller-token-8'

    # Case 3: Restaurant 8 in Sandbox with opt-in flag -> BLOCKED
    # (PAGBANK_PRODUCTION_RESTAURANT_IDS empty so 8 is sandbox)
    monkeypatch.delenv('PAGBANK_PRODUCTION_RESTAURANT_IDS', raising=False)
    monkeypatch.setenv('PAGBANK_APPLICATION_OWNER_ACCOUNT_ID', owner_acco)
    acc8.provider_environment = 'sandbox'
    db.flush()

    st = pagbank_payments.connection_status(db=db, user=u8)
    assert st['connected'] is False
    assert OnlinePaymentService.public_payment_capabilities(db, rid) == (False, False)
    with pytest.raises(OnlinePaymentConfigurationError, match='proprietária'):
        OnlinePaymentService.active_account(db, rid)

    with pytest.raises(HTTPException) as denied_sbx:
        pagbank_payments.complete(
            pagbank_payments.AuthorizationCompletion(code='valid-code', state='valid-state'),
            db=db, user=u8,
        )
    assert denied_sbx.value.status_code == 409

    # Case 4: Other restaurant (e.g. A = 99571) in production with opt-in flag -> BLOCKED
    monkeypatch.setenv('PAGBANK_PRODUCTION_RESTAURANT_IDS', '8,99571')
    user_a = db.query(Usuario).filter_by(restaurante_id=A).one()
    # Temporarily decouple acc8's provider_user_id so unique constraint (provider, provider_user_id) passes
    acc8.provider_user_id = 'ACCO_OTHER_8'
    db.flush()
    acc_a = account(db, A)
    acc_a.provider_environment = 'production'
    acc_a.provider_user_id = owner_acco
    db.flush()

    monkeypatch.setattr(pagbank_payments, 'require_tenant_id', lambda: A)
    st_a = pagbank_payments.connection_status(db=db, user=user_a)
    assert st_a['connected'] is False
    assert OnlinePaymentService.public_payment_capabilities(db, A) == (False, False)
    with pytest.raises(OnlinePaymentConfigurationError, match='proprietária'):
        OnlinePaymentService.active_account(db, A)

    monkeypatch.setattr(oauth, 'decode_state', lambda *_: (A, user_a.id))
    with pytest.raises(HTTPException) as denied_a:
        pagbank_payments.complete(
            pagbank_payments.AuthorizationCompletion(code='valid-code', state='valid-state'),
            db=db, user=user_a,
        )
    assert denied_a.value.status_code == 409
