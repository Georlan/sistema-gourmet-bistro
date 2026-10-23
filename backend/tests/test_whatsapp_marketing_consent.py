"""A viewed invitation or outgoing/provider echo is never consent evidence."""
import datetime as dt
from unittest.mock import MagicMock
from urllib.parse import urlsplit,parse_qs
from fastapi import FastAPI,HTTPException
from fastapi.testclient import TestClient
import pytest
from sqlalchemy.orm import Session
from app.services import whatsapp_marketing_consent as consent
from app.routes import whatsapp_marketing_consent as routes
from app.crm_models import CrmClientePreferencia
from app.timezone_utils import to_utc
from app.services.whatsapp_opt_out import block_contact
from app.services.central_whatsapp import recipient_fingerprint
from tests.test_whatsapp_registered_flow import flow
from tests.test_central_whatsapp_campaigns import seed

INBOUND_TEST_SECRET='x'*48  # Deliberately inert, test-local credential.


def activate(patch):
    patch.setenv('KOMA_CENTRAL_WA_CONSENT_ENABLED','true')
    patch.setenv('KOMA_CENTRAL_WA_INBOUND_SECRET',INBOUND_TEST_SECRET)
    patch.setenv('KOMA_CENTRAL_WA_ALLOWED_RESTAURANT_IDS','701,702')
    patch.setenv('KOMA_CENTRAL_WA_CONSENT_RESTAURANT_IDS','701,702')


def invitation(db,patch):
    activate(patch)
    _,client,pref=seed(db,proof=False)
    result=consent.prepare_invitation(db,701,client.id);db.commit()
    token=urlsplit(result['url']).fragment
    preview=consent.preview_invitation(db,token)
    text=parse_qs(urlsplit(preview['whatsapp_url']).query)['text'][0]
    payload={'event':'messages.upsert','instance':'business-test','sender':'5511888888888@s.whatsapp.net','data':{
        'key':{'fromMe':False,'remoteJid':client.telefone+'@s.whatsapp.net','id':'receipt-fixture-1'},
        'messageTimestamp':int(consent.now().timestamp()),'message':{'conversation':text}}}
    return client,pref,result,token,payload


def test_disabled_consent_performs_zero_database_work(monkeypatch):
    monkeypatch.delenv('KOMA_CENTRAL_WA_CONSENT_ENABLED',raising=False)
    db=MagicMock()
    with pytest.raises(HTTPException):consent.prepare_invitation(db,701,'client')
    assert not db.mock_calls


def test_preview_only_then_authenticated_confirmation_records_phone_bound_consent(flow):
    db,patch=flow
    client,pref,result,token,payload=invitation(db,patch)
    assert result['consent_confirmed'] is False
    assert '/w/c#' in result['url'] and '?' not in result['url']
    assert pref.whatsapp_marketing_opt_in is False and pref.whatsapp_interaction_at is None
    assert token not in str(pref.__dict__)
    assert consent.process_authenticated_inbound(db,payload)
    db.commit()
    assert pref.whatsapp_marketing_opt_in is True
    assert pref.whatsapp_interaction_phone_hash==recipient_fingerprint(701,client.telefone)
    assert pref.whatsapp_consent_nonce_hash is None and pref.whatsapp_consent_expires_at is None
    assert pref.whatsapp_marketing_consented_at==pref.whatsapp_interaction_at
    first=pref.whatsapp_interaction_at
    instant=consent.now()+dt.timedelta(minutes=5)
    patch.setattr(consent,'now',lambda:instant)
    assert not consent.process_authenticated_inbound(db,payload)
    assert to_utc(pref.whatsapp_interaction_at)==to_utc(first)  # Replay cannot renew 21-day window.
    assert db.query(CrmClientePreferencia).filter_by(restaurante_id=702,whatsapp_marketing_opt_in=True).count()==0


@pytest.mark.parametrize('bad',['from_me','wrong_instance','wrong_phone','group','missing_id','old','future','changed_text','no_confirmation','altered_token','wrong_business','missing_business','wrong_tag','wrong_tenant_code'])
def test_untrusted_or_nonconsensual_message_never_records_proof(flow,bad):
    db,patch=flow
    _,pref,_,_,payload=invitation(db,patch)
    data=payload['data']
    if bad=='wrong_business':payload['sender']='5511777771111@s.whatsapp.net'
    if bad=='missing_business':payload.pop('sender')
    if bad=='wrong_tag':
        text=data['message']['conversation'];data['message']['conversation']=text[:-1]+('a' if text[-1]!='a' else 'b')
    if bad=='wrong_tenant_code':data['message']['conversation']=data['message']['conversation'].replace('Confirmar KOMA: 2bd.','Confirmar KOMA: 2be.')
    if bad=='from_me':data['key']['fromMe']=True
    if bad=='wrong_instance':payload['instance']='other-business'
    if bad=='wrong_phone':data['key']['remoteJid']='5511999990000@s.whatsapp.net'
    if bad=='group':data['key']['remoteJid']='5511999999999@g.us'
    if bad=='missing_id':data['key'].pop('id')
    if bad=='old':data['messageTimestamp']-=601
    if bad=='future':data['messageTimestamp']+=120
    if bad=='changed_text':data['message']['conversation']='Não '+data['message']['conversation']
    if bad=='no_confirmation':data['message']['conversation']='Olá, quero ver meu pedido'
    if bad=='altered_token':data['message']['conversation']=data['message']['conversation'][:-3]+'xyz'
    assert not consent.process_authenticated_inbound(db,payload)
    assert pref.whatsapp_marketing_opt_in is False and pref.whatsapp_interaction_at is None


def test_new_invitation_invalidates_previous_and_changed_phone_blocks_confirmation(flow):
    db,patch=flow
    client,pref,_,_,payload=invitation(db,patch)
    consent.prepare_invitation(db,701,client.id);db.commit()
    assert not consent.process_authenticated_inbound(db,payload)
    client.telefone='5511988881111';db.commit()
    assert not consent.process_authenticated_inbound(db,payload)
    assert not pref.whatsapp_marketing_opt_in


def test_cancellation_always_wins_over_an_existing_invitation(flow):
    db,patch=flow
    client,pref,_,_,payload=invitation(db,patch)
    block_contact(db,701,recipient_fingerprint(701,client.telefone),marketing_only=True);db.commit()
    with pytest.raises(HTTPException):consent.process_authenticated_inbound(db,payload)
    assert not pref.whatsapp_marketing_opt_in


def test_inbound_authenticates_before_constructing_database_session(monkeypatch):
    monkeypatch.setenv('KOMA_CENTRAL_WA_CONSENT_ENABLED','true')
    monkeypatch.setenv('KOMA_CENTRAL_WA_INBOUND_SECRET',INBOUND_TEST_SECRET)
    factory=MagicMock(side_effect=AssertionError('Unauthenticated input cannot open a SQL session'))
    monkeypatch.setattr(routes,'SessionLocal',factory)
    app=FastAPI();app.include_router(routes.router)
    with TestClient(app) as client:
        response=client.post('/api/integrations/whatsapp/central/inbound',content=b'not-json')
        assert response.status_code==401
        response=client.post('/api/integrations/whatsapp/central/inbound',headers={'x-koma-whatsapp-secret':'wrong'},content=b'not-json')
        assert response.status_code==401
        monkeypatch.setenv('KOMA_CENTRAL_WA_CONSENT_ENABLED','false')
        assert client.post('/api/integrations/whatsapp/central/inbound').status_code==503
    factory.assert_not_called()


def test_real_authenticated_http_receiver_processes_only_scoped_confirmation(flow):
    db,patch=flow
    client,pref,_,_,payload=invitation(db,patch)
    patch.setattr(routes,'SessionLocal',lambda:Session(db.get_bind()))
    app=FastAPI();app.include_router(routes.router)
    with TestClient(app) as http:
        response=http.post('/api/integrations/whatsapp/central/inbound',headers={'x-koma-whatsapp-secret':INBOUND_TEST_SECRET},json=payload)
        assert response.status_code==200 and response.json()=={'status':'EVENT_RECEIVED'}
    db.expire_all()
    assert db.query(CrmClientePreferencia).filter_by(restaurante_id=701,cliente_id=client.id).one().whatsapp_marketing_opt_in is True


def test_expired_challenge_cannot_be_previewed_or_confirmed(flow):
    db,patch=flow
    _,pref,_,token,payload=invitation(db,patch)
    pref.whatsapp_consent_expires_at=consent.now()-dt.timedelta(seconds=1);db.commit()
    with pytest.raises(HTTPException):consent.preview_invitation(db,token)
    assert not consent.process_authenticated_inbound(db,payload)
    assert not pref.whatsapp_marketing_opt_in


def test_operator_preferences_cannot_assert_received_consent():
    from app.routes.customer_crm import UpdateCustomerPreferencesInput
    assert not {'whatsapp_consent_nonce_hash','whatsapp_consent_message_hash','whatsapp_marketing_consented_at'}.intersection(UpdateCustomerPreferencesInput.model_fields)


@pytest.mark.parametrize('mapped',[True,False])
def test_lid_requires_authenticated_phone_mapping_without_provider_lookup(flow,mapped):
    db,patch=flow
    client,pref,_,_,payload=invitation(db,patch)
    payload['data']['key']['remoteJid']='123456789@lid'
    if mapped:payload['data']['key']['remoteJidAlt']=client.telefone+'@s.whatsapp.net'
    assert consent.process_authenticated_inbound(db,payload) is mapped
    assert pref.whatsapp_marketing_opt_in is mapped


def test_group_or_conflicting_alternate_phone_never_proves_consent(flow):
    db,patch=flow
    client,pref,_,_,payload=invitation(db,patch)
    payload['data']['key']['remoteJidAlt']='5511991111222@s.whatsapp.net'
    assert not consent.process_authenticated_inbound(db,payload)
    payload['data']['key']['remoteJid']='123456789@g.us'
    payload['data']['key']['remoteJidAlt']=client.telefone+'@s.whatsapp.net'
    assert not consent.process_authenticated_inbound(db,payload)
    assert not pref.whatsapp_marketing_opt_in


def test_brazilian_phone_without_ninth_digit_uses_existing_identity_comparison(flow):
    db,patch=flow
    client,pref,_,_,payload=invitation(db,patch)
    phone=client.telefone
    payload['data']['key']['remoteJid']=phone[:4]+phone[5:]+'@s.whatsapp.net'
    assert consent.process_authenticated_inbound(db,payload)
    assert pref.whatsapp_interaction_phone_hash==recipient_fingerprint(701,phone)


def test_ordinary_authenticated_incoming_text_never_opens_a_database_query(flow):
    _,patch=flow
    activate(patch)
    db=MagicMock()
    payload={'event':'messages.upsert','instance':'business-test','sender':'5511888888888@s.whatsapp.net','data':{
        'key':{'fromMe':False,'remoteJid':'5511999997777@s.whatsapp.net','id':'normal-text-fixture'},
        'messageTimestamp':int(consent.now().timestamp()),'message':{'conversation':'Olá, qual o horário?'}}}
    assert not consent.process_authenticated_inbound(db,payload)
    assert not db.mock_calls


def test_crm_refresh_shows_cancellation_without_changing_historical_proof(flow):
    db,patch=flow
    client,pref,_,_,payload=invitation(db,patch)
    assert consent.process_authenticated_inbound(db,payload)
    from app.services.customer_crm import enrich_customer_crm_payloads
    def refreshed():
        return enrich_customer_crm_payloads(db,restaurante_id=701,
            payloads=[{'id':client.id,'telefone':client.telefone,'pedidos_concluidos':1}],loyalty_enabled=False)[0]
    assert refreshed()['whatsapp_campaign_interaction_verified'] is True
    block_contact(db,701,recipient_fingerprint(701,client.telefone),marketing_only=True);db.commit()
    current=refreshed()
    assert current['opt_out_marketing'] is True
    assert current['whatsapp_campaign_interaction_verified'] is False
    assert pref.whatsapp_marketing_consented_at is not None  # Preserve the audit receipt.
    pref.whatsapp_interaction_at=consent.now()-dt.timedelta(days=22);db.commit()
    assert refreshed()['opt_out_marketing'] is True  # Cancellation never expires with the interaction window.
    client.telefone='5511988882222';db.commit()
    current=refreshed()
    assert current['opt_out_marketing'] is False  # Old-phone cancellation never migrates to a new owner.
    assert current['whatsapp_campaign_interaction_verified'] is False
