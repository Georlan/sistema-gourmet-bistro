"""Marketing never borrows order authorization, phone registration or daily quota."""
import datetime as dt
from unittest.mock import MagicMock
import pytest
from fastapi import HTTPException
from app.crm_models import CrmCampanha, CrmClientePreferencia
from app.models import Cliente, IntegrationOutbox, CentralWhatsAppSenderState
from app.services import central_whatsapp_campaigns as campaigns
from app.services import central_whatsapp as central
from app.services.outbox.dispatcher import dispatch_single_outbox_event
from tests.test_whatsapp_registered_flow import flow, provider, config


def seed(db, rid=701, suffix='1', *, proof=True):
    phone = f'551199990{int(suffix):04}'
    client = Cliente(id=f'client-{rid}-{suffix}', restaurante_id=rid, nome='Pessoa Fixture', telefone=phone)
    campaign = CrmCampanha(id=f'campaign-{rid}-{suffix}', restaurante_id=rid, nome='Campanha Fixture', objetivo='CUSTOM', segmento_filtro='ALL', abordagem_tipo='SEM_DESCONTO', template_mensagem='Olá, {nome}! Confira as novidades da loja.', status='EM_EXECUCAO')
    db.add_all([client, campaign]); db.flush()
    pref = CrmClientePreferencia(restaurante_id=rid, cliente_id=client.id,
        whatsapp_marketing_opt_in=proof,
        whatsapp_interaction_at=campaigns.campaign_now()-dt.timedelta(days=1) if proof else None,
        whatsapp_interaction_phone_hash=central.recipient_fingerprint(rid, phone) if proof else None)
    db.add(pref); db.commit()
    return campaign, client, pref


def activate(patch):
    patch.setattr(campaigns, "campaign_now", lambda: dt.datetime.now(dt.timezone.utc).replace(hour=15,minute=0,second=0,microsecond=0))
    patch.setenv('KOMA_CENTRAL_WA_CAMPAIGNS_ENABLED', 'true')
    patch.setenv('KOMA_CENTRAL_WA_ALLOWED_RESTAURANT_IDS', '701,702')
    patch.setenv('KOMA_CENTRAL_WA_CAMPAIGN_RESTAURANT_IDS', '701,702')


def test_disabled_campaign_lane_has_zero_database_and_provider_work(monkeypatch):
    monkeypatch.delenv('KOMA_CENTRAL_WA_CAMPAIGNS_ENABLED', raising=False)
    db = MagicMock()
    with pytest.raises(HTTPException): campaigns.enqueue_campaign(db, 701, 'campaign','client')
    assert not db.mock_calls
    assert campaigns.policy()['daily_scope'] == 'shared_sender'


@pytest.mark.parametrize('invalid', ['no_proof','old','future','changed_phone','opt_out','no_marketing_consent','wrong_tenant'])
def test_campaign_blocks_before_outbox_without_current_verified_interaction(flow, invalid):
    db, patch = flow
    activate(patch)
    campaign, client, pref = seed(db)
    if invalid == 'no_proof': pref.whatsapp_interaction_at = None
    if invalid == 'old': pref.whatsapp_interaction_at = dt.datetime.now(dt.timezone.utc)-dt.timedelta(days=22)
    if invalid == 'future': pref.whatsapp_interaction_at = dt.datetime.now(dt.timezone.utc)+dt.timedelta(days=1)
    if invalid == 'changed_phone': client.telefone = '5511988888888'
    if invalid == 'opt_out': pref.opt_out_marketing = True
    if invalid == 'no_marketing_consent': pref.whatsapp_marketing_opt_in = False
    db.commit()
    transport = MagicMock(side_effect=AssertionError('no HTTP for ineligible marketing'))
    patch.setattr(central.httpx, 'Client', transport)
    with pytest.raises(HTTPException):
        campaigns.enqueue_campaign(db, 702 if invalid == 'wrong_tenant' else 701, campaign.id, client.id)
    assert not db.query(IntegrationOutbox).filter_by(event_name=campaigns.EVENT_NAME).count()
    transport.assert_not_called()


def test_receipt_is_bound_to_current_phone_and_not_exposed_in_preferences_input():
    from app.routes.customer_crm import UpdateCustomerPreferencesInput
    assert not {'whatsapp_interaction_at','whatsapp_marketing_opt_in','whatsapp_interaction_phone_hash'}.intersection(UpdateCustomerPreferencesInput.model_fields)


def test_campaign_send_uses_central_sender_then_cooldown_and_dedup(flow):
    db, patch = flow
    activate(patch)
    campaign, client, pref = seed(db)
    # Renderer uses the same canonical profile; no fabricated benefits.
    patch.setattr('app.services.customer_crm.get_customer_crm_profile', lambda *a, **kw: {'cliente': {}})
    row = campaigns.enqueue_campaign(db,701,campaign.id,client.id)
    row.created_at = campaigns.campaign_now()-dt.timedelta(minutes=1)
    assert campaigns.enqueue_campaign(db,701,campaign.id,client.id) is row
    db.commit()
    calls = provider(patch)
    assert dispatch_single_outbox_event(db,row)
    assert len(calls)==1 and calls[0]['number']==client.telefone
    assert 'KÔMA' in calls[0]['text'] and 'Parar de receber' in calls[0]['text']
    assert row.status=='delivered'  # Provider HTTP acceptance, never handset proof.
    assert not {'text','phone','nome'}.intersection(row.payload)
    assert db.query(CentralWhatsAppSenderState).one().campaign_attempts==1
    with pytest.raises(HTTPException): campaigns.enqueue_campaign(db,701,campaign.id,client.id)
    assert len(calls)==1


def test_shared_daily_cap_is_five_across_restaurants_and_orders_do_not_count(flow):
    db, patch = flow
    activate(patch)
    patch.setattr('app.services.customer_crm.get_customer_crm_profile', lambda *a, **kw: {'cliente': {}})
    calls = provider(patch)
    from tests.test_whatsapp_registered_flow import order
    _, _, event = order(db)
    operational = central.enqueue_operator_alert(db, event);db.commit()
    assert dispatch_single_outbox_event(db, operational)
    assert (db.query(CentralWhatsAppSenderState).one().campaign_attempts or 0)==0
    for n in range(1,7):
        rid = 701 if n%2 else 702
        campaign, client, _ = seed(db,rid,str(n))
        state=db.query(CentralWhatsAppSenderState).one()
        state.next_send_at=dt.datetime.now(dt.timezone.utc)-dt.timedelta(minutes=1)
        config(db,rid).whatsapp_next_send_at=state.next_send_at
        db.commit()
        row=campaigns.enqueue_campaign(db,rid,campaign.id,client.id);row.created_at=campaigns.campaign_now()-dt.timedelta(minutes=1);db.commit()
        assert dispatch_single_outbox_event(db,row) is (n<=5)
    assert row.status == "failed" and row.next_retry_at is not None
    assert row.attempts == 0  # No provider request for the sixth marketing message.
    assert len(calls)==6  # One operational notice + five campaigns total.
    assert db.query(CentralWhatsAppSenderState).one().campaign_attempts==5


def test_new_campaign_cannot_bypass_seven_day_recipient_cooldown(flow):
    db, patch=flow;activate(patch)
    campaign,client,pref=seed(db)
    pref.whatsapp_campaign_last_sent_at=dt.datetime.now(dt.timezone.utc)-dt.timedelta(days=6)
    db.commit()
    with pytest.raises(HTTPException, match='7 dias'):
        campaigns.enqueue_campaign(db,701,campaign.id,client.id)


@pytest.mark.parametrize('hour,expected_day,expected_hour', [(8,23,13),(15,None,None),(0,23,13),(23,None,None)])
def test_campaign_window_uses_fortaleza_time(hour,expected_day,expected_hour):
    now=dt.datetime(2026,10,23,hour,tzinfo=dt.timezone.utc)
    target=campaigns.next_campaign_window(now)
    if expected_day is None: assert target is None
    else: assert (target.day,target.hour)==(expected_day,expected_hour)


def test_campaign_crossing_closing_time_during_provider_verification_never_sends(flow):
    db, patch = flow
    activate(patch)
    campaign, client, _ = seed(db)
    row = campaigns.enqueue_campaign(db, 701, campaign.id, client.id)
    row.created_at = campaigns.campaign_now()-dt.timedelta(minutes=1)
    db.commit()
    def closes_during_check(*args):
        patch.setattr(campaigns, 'campaign_now', lambda: dt.datetime.now(dt.timezone.utc).replace(hour=0,minute=1,second=0,microsecond=0)+dt.timedelta(days=1))
        return 'matched'
    calls = provider(patch, verify=closes_during_check)
    assert not dispatch_single_outbox_event(db, row)
    assert not calls
    assert row.status == 'dead_letter'


def test_marketing_cancellation_preserves_order_notices_and_other_restaurants(flow):
    db, patch = flow
    activate(patch)
    campaign, client, _ = seed(db)
    from app.services.whatsapp_opt_out import create_opt_out_token, resolve_opt_out_token, marketing_only_capability, block_contact
    from app.services.customer_whatsapp_dispatch import opted_out
    token = create_opt_out_token(701, client.telefone, db, marketing_only=True)
    db.commit()
    rid, digest = resolve_opt_out_token(token, db)
    assert rid == 701 and marketing_only_capability(token, db, rid)
    block_contact(db, rid, digest, marketing_only=True); db.commit()
    assert not opted_out(db, 701, digest)
    assert opted_out(db, 701, digest, include_marketing=True)
    assert not opted_out(db, 702, central.recipient_fingerprint(702, client.telefone), include_marketing=True)
    with pytest.raises(HTTPException): campaigns.enqueue_campaign(db, 701, campaign.id, client.id)
    # An all-notices cancellation strengthens an existing promotional one;
    # subsequent promotional replays cannot silently turn order notices on.
    block_contact(db, rid, digest); db.commit()
    block_contact(db, rid, digest, marketing_only=True); db.commit()
    assert opted_out(db, 701, digest)
