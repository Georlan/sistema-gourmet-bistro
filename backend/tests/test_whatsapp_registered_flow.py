"""Dynamic destinations and order consent, with simulated provider only."""
import datetime as dt
from dataclasses import replace
from decimal import Decimal
from types import SimpleNamespace

import httpx
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.domain.orders.events import OrderCreated, OrderReady, OrderDispatched, OrderCancelled
from app.domain.orders.types import FulfillmentType, OrderChannel
from app.models import Comanda, ConfiguracaoRestaurante, IntegrationOutbox, Lancamento, Restaurante, Usuario, WhatsAppContactOptOut
from app.services import central_whatsapp as central
from app.services import customer_whatsapp_dispatch as customer
from app.services.outbox.dispatcher import dispatch_single_outbox_event, recover_stale_outbox_claims
from app.services.outbox.publisher import enqueue_outbox_event_in_session
from app.services.whatsapp_opt_out import block_contact, create_opt_out_token, resolve_opt_out_token


@pytest.fixture
def flow(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path}/wa.db")
    Base.metadata.create_all(engine)
    monkeypatch.setenv('KOMA_CENTRAL_WA_ENABLED', 'true')
    monkeypatch.setenv('KOMA_CENTRAL_WA_PILOT_RESTAURANT_ID', '701')
    monkeypatch.setenv('KOMA_CENTRAL_WA_SENDER_PHONE', '5511888888888')
    monkeypatch.setenv('KOMA_CENTRAL_WA_INSTANCE_NAME', 'business-test')
    monkeypatch.setenv('KOMA_CUSTOMER_WA_ENABLED', 'true')
    monkeypatch.setenv('KOMA_CUSTOMER_WA_MONTHLY_MESSAGE_LIMIT', '10')
    monkeypatch.setenv('KOMA_CUSTOMER_WA_UNIT_COST_BRL', '0.035')
    monkeypatch.setenv('EVOLUTION_API_URL', 'https://provider.example.test')
    monkeypatch.setenv('EVOLUTION_API_KEY', 'test-only')
    with Session(engine, autoflush=False, expire_on_commit=False) as db:
        for rid in (701, 702):
            db.add(Restaurante(id=rid, nome=f'Loja teste {rid}', slug=f'test-{rid}'))
            db.add(Usuario(id=f'operator-{rid}', restaurante_id=rid, nome='Operador', senha_hash='test-only', cargo='admin'))
            db.add(ConfiguracaoRestaurante(restaurante_id=rid, whatsapp_instance_name=central.CENTRAL_INSTANCE_MARKER,
                whatsapp_recipient_phone='5511999999999' if rid == 701 else '5521999999999', whatsapp_alerts_enabled=False))
        db.commit()
        yield db, monkeypatch
    engine.dispose()


def order(db, *, rid=701, consent=True, suffix='1', kind='Retirada', phone='5511777777777'):
    check = Comanda(id=f'check-{rid}-{suffix}', restaurante_id=rid, garcom_id=f'operator-{rid}',
        numero_pedido=int(suffix), tipo=kind, identificador='Cliente teste',
        delivery_telefone=phone, delivery_status='pendente', whatsapp_status_opt_in=consent)
    db.add(check)
    db.flush()
    source = Lancamento(id=f'order-{rid}-{suffix}', restaurante_id=rid, comanda_id=check.id,
        garcom_id=f'operator-{rid}', origem='cardapio', status='pendente')
    db.add(source)
    db.flush()
    event = OrderCreated(restaurant_id=rid, order_id=source.id, check_id=check.id, display_number=str(suffix),
        channel=OrderChannel.WEB_CARDAPIO, fulfillment=FulfillmentType.PICKUP if kind == 'Retirada' else FulfillmentType.DELIVERY,
        total=Decimal('20'), customer_phone=phone)
    return check, source, event


def publish(db, event):
    enqueue_outbox_event_in_session(db, event, aggregate_id=str(event.order_id))
    db.commit()
    return db.query(IntegrationOutbox).filter_by(restaurante_id=event.restaurant_id, event_name=customer.EVENT_NAME).all()


def provider(monkeypatch, *, code=201, verify=None, timeout=False):
    calls = []
    monkeypatch.setattr(central, '_provider_sender_status', verify or (lambda *args: 'matched'))
    class Client:
        def __init__(self, **kwargs): pass
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def post(self, url, **kwargs):
            calls.append(kwargs['json'])
            if timeout:
                raise httpx.ReadTimeout('simulated')
            return httpx.Response(code)
    monkeypatch.setattr(central.httpx, 'Client', Client)
    return calls


def config(db, rid=701):
    return db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=rid).one()


def test_operator_uses_latest_registration_and_ignores_old_fixed_numbers(flow):
    db, patch = flow
    patch.setenv('KOMA_CENTRAL_WA_OPERATOR_PHONE', '5511666666666')
    patch.setenv('KOMA_CENTRAL_WA_PILOT_CUSTOMER_PHONE', '5511555555555')
    check, source, event = order(db, consent=False, phone='5511444444444')
    row = central.enqueue_operator_alert(db, event)
    db.commit()
    # Registration update before dispatch is authoritative, without a deploy.
    config(db).whatsapp_recipient_phone = '5511333333333'
    db.commit()
    calls = provider(patch)
    assert dispatch_single_outbox_event(db, row)
    assert calls[0]['number'] == '5511333333333'
    assert '5511444444444' not in str(row.payload)
    assert dispatch_single_outbox_event(db, row)
    assert len(calls) == 1


@pytest.mark.parametrize('change', ['removed', 'same_sender', 'individual', 'disabled', 'wrong_tenant', 'expired'])
def test_operator_fails_closed_on_missing_or_unauthorized_target(flow, change):
    db, patch = flow
    check, source, event = order(db)
    row = central.enqueue_operator_alert(db, event)
    db.commit()
    cfg = config(db)
    if change == 'removed': cfg.whatsapp_recipient_phone = None
    if change == 'same_sender': cfg.whatsapp_recipient_phone = '5511888888888'
    if change == 'individual': cfg.whatsapp_instance_name = 'koma-restaurant-701'
    if change == 'disabled': patch.setenv('KOMA_CENTRAL_WA_ENABLED', 'false')
    if change == 'wrong_tenant': row.payload = dict(row.payload, restaurant_id=702)
    if change == 'expired': row.created_at = dt.datetime.now(dt.timezone.utc)-dt.timedelta(minutes=11)
    db.commit()
    calls = provider(patch)
    assert not dispatch_single_outbox_event(db, row)
    assert row.status == 'dead_letter'
    assert not calls


def test_other_tenant_never_queues_or_borrows_registration(flow):
    db, patch = flow
    check, source, event = order(db, rid=702)
    assert central.enqueue_operator_alert(db, event) is None
    assert not publish(db, event)
    # A second synthetic tenant can be explicitly released in simulation;
    # it resolves its own recipient, never the first tenant's number.
    patch.setenv('KOMA_CENTRAL_WA_PILOT_RESTAURANT_ID', '702')
    row = central.enqueue_operator_alert(db, event)
    db.commit()
    calls = provider(patch)
    assert dispatch_single_outbox_event(db, row)
    assert calls[0]['number'] == '5521999999999'


def test_customer_receives_only_after_consent_and_from_same_order(flow):
    db, patch = flow
    check, source, event = order(db)
    rows = publish(db, event)
    assert len(rows) == 1
    row = rows[0]
    assert '5511777777777' not in str(row.payload)
    assert 'Cliente teste' not in str(row.payload)
    calls = provider(patch)
    assert dispatch_single_outbox_event(db, row)
    assert calls[0]['number'] == check.delivery_telefone
    assert 'Pedido recebido' in calls[0]['text']
    assert '/whatsapp/avisos#token=' in calls[0]['text']
    assert 'Loja teste 701' in calls[0]['text']
    assert len(publish(db, replace(event, event_id='canonical-replay'))) == 1


@pytest.mark.parametrize('condition', ['no_consent', 'off', 'no_tariff', 'no_limit', 'foreign', 'not_released'])
def test_customer_is_default_off_and_does_not_use_operator_consent(flow, condition):
    db, patch = flow
    check, source, event = order(db, consent=condition != 'no_consent')
    if condition == 'off': patch.delenv('KOMA_CUSTOMER_WA_ENABLED')
    if condition == 'no_tariff': patch.delenv('KOMA_CUSTOMER_WA_UNIT_COST_BRL')
    if condition == 'no_limit': patch.delenv('KOMA_CUSTOMER_WA_MONTHLY_MESSAGE_LIMIT')
    if condition == 'foreign': patch.setenv('KOMA_CENTRAL_WA_PILOT_RESTAURANT_ID', '702')
    if condition == 'not_released':
        assert customer.enqueue_customer_notice(db, event, 'koma.order.created') is None
    else:
        assert publish(db, event) == []


@pytest.mark.parametrize('change', ['opt_out', 'changed_phone', 'no_consent', 'expired', 'outdated', 'foreign'])
def test_revalidate_customer_consent_phone_tenant_age_and_last_state(flow, change):
    db, patch = flow
    check, source, event = order(db)
    row = publish(db, event)[0]
    if change == 'opt_out': block_contact(db, 701, central.recipient_fingerprint(701, check.delivery_telefone))
    if change == 'changed_phone': check.delivery_telefone = '5511222222222'
    if change == 'no_consent': check.whatsapp_status_opt_in = False
    if change == 'expired': row.created_at = dt.datetime.now(dt.timezone.utc)-dt.timedelta(minutes=11)
    if change == 'outdated': check.delivery_status = 'pronto'
    if change == 'foreign': row.payload = dict(row.payload, restaurant_id=702)
    db.commit()
    calls = provider(patch)
    assert not dispatch_single_outbox_event(db, row)
    assert not calls


def test_revocation_during_provider_identity_check_prevents_send(flow):
    db, patch = flow
    check, source, event = order(db)
    row = publish(db, event)[0]
    def revoke(*args):
        block_contact(db, 701, central.recipient_fingerprint(701, check.delivery_telefone))
        db.commit()
        return 'matched'
    calls = provider(patch, verify=revoke)
    assert not dispatch_single_outbox_event(db, row)
    assert not calls


def test_minimal_milestones_and_no_partial_ready(flow):
    db, patch = flow
    check, source, event = order(db)
    publish(db, event)
    ready = OrderReady(restaurant_id=701, order_id=source.id, check_id=check.id, fulfillment=FulfillmentType.PICKUP)
    # One ready Lancamento does not mean the whole Comanda is ready.
    source.status = 'pronto'
    publish(db, ready)
    assert db.query(IntegrationOutbox).filter_by(event_name=customer.EVENT_NAME).count() == 1
    check.delivery_status = 'pronto'
    rows = publish(db, replace(ready, event_id='whole-check-ready'))
    assert len(rows) == 2
    calls = provider(patch)
    final = next(r for r in rows if r.payload['kind'] == 'customer_ready_pickup')
    assert dispatch_single_outbox_event(db, final)
    assert 'pronto para retirada' in calls[0]['text']


def test_delivery_ready_is_silent_until_dispatch_and_cancellation_is_separate(flow):
    db, patch = flow
    check, source, event = order(db, kind='Delivery')
    publish(db, event)
    check.delivery_status = 'pronto'
    rows = publish(db, OrderReady(restaurant_id=701, order_id=source.id, check_id=check.id, fulfillment=FulfillmentType.DELIVERY))
    assert len(rows) == 1
    check.delivery_status = 'transito'
    rows = publish(db, OrderDispatched(restaurant_id=701, order_id=source.id, check_id=check.id))
    assert len(rows) == 2
    check.delivery_status = 'recusado'
    rows = publish(db, OrderCancelled(restaurant_id=701, order_id=source.id, check_id=check.id))
    assert len(rows) == 3
    assert {r.payload['kind'] for r in rows} == {'customer_received','customer_dispatched','customer_cancelled'}


def test_budget_is_durable_after_outbox_cleanup_and_reregistration(flow):
    db, patch = flow
    patch.setenv('KOMA_CUSTOMER_WA_MONTHLY_MESSAGE_LIMIT', '1')
    check, source, event = order(db)
    row = publish(db, event)[0]
    calls = provider(patch)
    assert dispatch_single_outbox_event(db, row)
    cfg = config(db)
    assert cfg.whatsapp_budget_attempts == 1
    assert cfg.whatsapp_budget_cost == Decimal('0.0350')
    db.delete(row)
    cfg.whatsapp_next_send_at = None
    cfg.whatsapp_recipient_phone = '5511333333333'
    db.commit()
    check2, source2, event2 = order(db, suffix='2')
    row2 = publish(db, event2)[0]
    assert not dispatch_single_outbox_event(db, row2)
    assert len(calls) == 1
    patch.setenv('KOMA_CUSTOMER_WA_MONTHLY_MESSAGE_LIMIT', '100')
    patch.setenv('KOMA_CUSTOMER_WA_MONTHLY_BUDGET_BRL', '0.05')
    assert not customer.budget_available(cfg)


def test_timeout_has_no_automatic_replay_and_reserves_budget(flow):
    db, patch = flow
    check, source, event = order(db)
    row = publish(db, event)[0]
    calls = provider(patch, timeout=True)
    assert not dispatch_single_outbox_event(db, row)
    assert row.status == 'dead_letter'
    assert not dispatch_single_outbox_event(db, row)
    assert len(calls) == 1
    assert config(db).whatsapp_budget_attempts == 1


def test_optout_token_is_scoped_idempotent_and_not_staff_login(flow):
    db, patch = flow
    token = create_opt_out_token(701, '5511777777777')
    rid, digest = resolve_opt_out_token(token)
    assert rid == 701
    assert digest == central.recipient_fingerprint(701, '5511777777777')
    block_contact(db, rid, digest)
    block_contact(db, rid, digest)
    db.commit()
    assert db.query(WhatsAppContactOptOut).count() == 1
    assert not customer.opted_out(db, 702, digest)
    import jwt
    from app.config import settings
    forged = jwt.encode({'type':'customer','rid':701,'contact':digest,'exp':dt.datetime.now(dt.timezone.utc)+dt.timedelta(days=1)}, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    with pytest.raises(ValueError): resolve_opt_out_token(forged)
    with pytest.raises(ValueError): resolve_opt_out_token(token+'tampered')


def test_released_tenants_share_cooldown_and_resolve_distinct_destinations(flow):
    from app.models import CentralWhatsAppSenderState
    db, patch = flow
    patch.setenv('KOMA_CENTRAL_WA_ALLOWED_RESTAURANT_IDS', '701,702')
    rows = []
    for rid in (701,702):
        check, source, event = order(db,rid=rid)
        rows.append(central.enqueue_operator_alert(db,event))
    db.commit()
    calls = provider(patch)
    assert dispatch_single_outbox_event(db,rows[0])
    assert not dispatch_single_outbox_event(db,rows[1])
    assert rows[1].status == 'failed'
    assert len(calls) == 1
    state = db.query(CentralWhatsAppSenderState).one()
    state.next_send_at = dt.datetime.now(dt.timezone.utc)-dt.timedelta(seconds=1)
    db.commit()
    assert dispatch_single_outbox_event(db,rows[1])
    assert [call['number'] for call in calls] == ['5511999999999','5521999999999']
    # Enabling the operator for multiple tenants never expands customer rollout.
    assert not customer.customer_notices_enabled(702, config(db,702))


def test_provider_429_opens_global_circuit_for_other_restaurants(flow):
    from app.models import CentralWhatsAppSenderState
    db, patch = flow
    patch.setenv('KOMA_CENTRAL_WA_ALLOWED_RESTAURANT_IDS', '701,702')
    rows=[]
    for rid in (701,702):
        _, _, event = order(db,rid=rid)
        rows.append(central.enqueue_operator_alert(db,event))
    db.commit()
    calls=provider(patch,code=429)
    assert not dispatch_single_outbox_event(db,rows[0])
    state=db.query(CentralWhatsAppSenderState).one()
    assert state.circuit_open_until is not None
    assert not dispatch_single_outbox_event(db,rows[1])
    assert len(calls) == 1


@pytest.mark.parametrize('value',['','*','all','701,garbage','0','701,0'])
def test_allowlist_cannot_implicitly_enable_all_tenants(flow,value):
    _, patch=flow
    patch.setenv('KOMA_CENTRAL_WA_ALLOWED_RESTAURANT_IDS',value)
    assert central.pilot_configuration() is None



def test_financially_closed_check_still_alerts_for_active_production(flow):
    db, patch = flow
    check, source, event = order(db,consent=False)
    check.fechada = True  # Financial closure is independent of kitchen state.
    check.delivery_status = 'producao'
    row=central.enqueue_operator_alert(db,event)
    db.commit()
    calls=provider(patch)
    assert dispatch_single_outbox_event(db,row)
    assert len(calls) == 1
