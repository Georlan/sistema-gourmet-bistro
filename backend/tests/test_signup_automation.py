import datetime as dt
import json
import pytest
from sqlalchemy import text
from app.routes import signups, saas_billing
from app.routes.super_admin import get_current_admin
from app.signup_models import RestaurantSignup, SignupNotification
from app.saas_billing_models import SaaSBillingSetup, SaaSSubscription
from app.services import signup_notifications
from app.services.saas_mercadopago import default_saas_mp_service
from test_saas_billing_checkout import client_and_session, _contract_payload, _verified_pix_payment

DATA = {"restaurant_name": "Novo Bistrô", "responsible_name": "Ana Silva", "email": "ana@example.com", "phone": "85999999999", "plan": "pro", "billing_cycle": "mensal"}

@pytest.fixture()
def signup_client(client_and_session):
    client, Session = client_and_session
    client.app.include_router(signups.router)
    client.app.include_router(signups.admin_router, prefix="/api/super-admin")
    return client, Session


def test_signup_is_persisted_before_payment_and_resume_requires_secret(signup_client):
    client, Session = signup_client
    created = client.post('/api/signups', json=DATA)
    assert created.status_code == 201, created.text
    saved = created.json()
    with Session() as db:
        row = db.query(RestaurantSignup).one()
        assert row.token_hash != saved['token']
        assert DATA['email'] not in row.payload_encrypted
        assert db.query(SaaSBillingSetup).count() == 0
    assert client.get('/api/signups/current').status_code == 404
    assert client.get('/api/signups/current', headers={'X-Signup-Token': 'x'*43}).status_code == 404
    resumed = client.get('/api/signups/current', headers={'X-Signup-Token': saved['token']})
    assert resumed.status_code == 200
    assert resumed.json()['data'] == DATA
    assert resumed.headers['cache-control'] == 'no-store'


def test_signup_expiry_and_admin_authorization(signup_client):
    client, Session = signup_client
    token = client.post('/api/signups', json=DATA).json()['token']
    assert client.get('/api/super-admin/signups').status_code in (401,403)
    client.app.dependency_overrides[get_current_admin] = lambda: {'user': 'operator'}
    assert client.get('/api/super-admin/signups').json()['items'][0]['status'] == 'started'
    with Session() as db:
        db.query(RestaurantSignup).update({'expires_at': dt.datetime.now(dt.timezone.utc)-dt.timedelta(seconds=1)})
        db.commit()
    assert client.get('/api/signups/current', headers={'X-Signup-Token':token}).status_code == 404


def test_resume_recovers_accepted_contract_without_duplicate(signup_client):
    client, Session = signup_client
    saved = client.post('/api/signups', json=DATA).json()
    payload = _contract_payload(); payload.update(request_id=saved['id'], signup_token=saved['token'])
    first = client.post('/api/contracts/accept', json=payload)
    assert first.status_code == 201, first.text
    replay = client.post('/api/contracts/accept', json=payload)
    assert replay.json()['protocol'] == first.json()['protocol']
    resumed = client.get('/api/signups/current', headers={'X-Signup-Token':saved['token']})
    assert resumed.json()['receipt']['protocol'] == first.json()['protocol']
    with Session() as db:
        assert db.query(SignupNotification).count() == 2


def test_notification_failure_persists_and_retries(signup_client, monkeypatch):
    client, Session = signup_client
    client.post('/api/contracts/accept', json=_contract_payload())
    monkeypatch.setattr(signup_notifications, 'SessionLocal', Session)
    def fail(*args): raise RuntimeError('email_not_configured')
    monkeypatch.setattr(signup_notifications, '_deliver', fail)
    signup_notifications.dispatch_batch()
    with Session() as db:
        rows = db.query(SignupNotification).all()
        assert all(row.status == 'pending' and row.attempts == 1 for row in rows)
        db.query(SignupNotification).update({'next_attempt_at': dt.datetime.now(dt.timezone.utc)-dt.timedelta(seconds=1)})
        db.commit()
    sent = []
    monkeypatch.setattr(signup_notifications, '_deliver', lambda payload, key: sent.append(key))
    signup_notifications.dispatch_batch()
    signup_notifications.dispatch_batch()
    assert len(sent) == 2
    with Session() as db:
        assert all(row.status == 'sent' and row.payload_encrypted == '' for row in db.query(SignupNotification))


def test_pix_replay_recovers_provisioning_after_payment_commit(client_and_session, monkeypatch):
    client, Session = client_and_session
    protocol = client.post('/api/contracts/accept', json=_contract_payload('pocket','anual')).json()['protocol']
    setup = client.post(f'/api/contracts/{protocol}/billing/setup', json={'payment_method_type':'pix'}).json()
    monkeypatch.setattr(default_saas_mp_service, 'verify_webhook_signature', lambda **kwargs: True)
    monkeypatch.setattr(default_saas_mp_service, 'get_payment', lambda key: _verified_pix_payment(key,protocol))
    original = saas_billing.provision_restaurant_for_contract
    def fail(*args, **kwargs): raise RuntimeError('simulated restart')
    monkeypatch.setattr(saas_billing, 'provision_restaurant_for_contract', fail)
    event = {'type':'payment', 'data':{'id':setup['paymentId']}}
    with pytest.raises(RuntimeError): client.post('/api/integrations/saas-billing/mercado-pago/webhook', json=event)
    monkeypatch.setattr(saas_billing, 'provision_restaurant_for_contract', original)
    response = client.post('/api/integrations/saas-billing/mercado-pago/webhook', json=event)
    assert response.status_code == 200, response.text
    assert response.json()['activated']
    assert client.post('/api/integrations/saas-billing/mercado-pago/webhook', json=event).status_code == 200
    with Session() as db:
        sub = db.query(SaaSSubscription).one()
        assert (sub.current_period_end-sub.current_period_start).days in (372,373)


def test_card_without_authorization_never_activates(client_and_session, monkeypatch):
    client, Session = client_and_session
    protocol = client.post('/api/contracts/accept', json=_contract_payload()).json()['protocol']
    monkeypatch.setattr(default_saas_mp_service, 'create_preapproval', lambda **kwargs: {'id':'unconfirmed','status':'pending'})
    response = client.post(f'/api/contracts/{protocol}/billing/setup', json={'payment_method_type':'credit_card','card_token_id':'test-token'})
    assert response.status_code == 402
    with Session() as db:
        assert db.query(SaaSSubscription).count() == 0
        assert db.query(SaaSBillingSetup).one().status == 'pending'


def test_recurring_authorization_is_not_payment_and_invoice_replay_does_not_extend_access(client_and_session, monkeypatch):
    from app.services.saas_invoice_reconciliation import reconcile_invoice
    from app.services.billing_service import resolve_tenant_entitlement
    client, Session = client_and_session
    protocol = client.post('/api/contracts/accept', json=_contract_payload()).json()['protocol']
    client.post(f'/api/contracts/{protocol}/billing/setup', json={'payment_method_type':'credit_card','card_token_id':'test-token'})
    with Session() as db:
        sub = db.query(SaaSSubscription).one()
        sub_id = sub.provider_subscription_id
        tenant = sub.restaurante_id
        sub.trial_ends_at = dt.datetime.now(dt.timezone.utc)-dt.timedelta(days=1)
        sub.current_period_end = sub.trial_ends_at
        db.commit()
    monkeypatch.setattr(default_saas_mp_service, 'verify_webhook_signature', lambda **kwargs: True)
    monkeypatch.setattr(default_saas_mp_service, 'get_preapproval', lambda key: {'id':sub_id,'status':'authorized','external_reference':protocol})
    client.post('/api/integrations/saas-billing/mercado-pago/webhook', json={'type':'subscription_preapproval','data':{'id':sub_id}})
    with Session() as db:
        assert not resolve_tenant_entitlement(db, tenant).allowed
    monkeypatch.setattr(default_saas_mp_service, 'get_authorized_payment', lambda key: {'preapproval_id':sub_id,'payment':{'id':'invoice-payment'}})
    paid_at = dt.datetime.now(dt.timezone.utc).isoformat()
    monkeypatch.setattr(default_saas_mp_service, 'get_payment', lambda key: {'id':key,'status':'approved','date_approved':paid_at,'currency_id':'BRL','transaction_amount':209})
    with Session() as db:
        assert reconcile_invoice(db,'invoice-1')['reconciled']
        end = db.query(SaaSSubscription).one().current_period_end
        assert resolve_tenant_entitlement(db, tenant).allowed
        reconcile_invoice(db,'invoice-1')
        assert db.query(SaaSSubscription).one().current_period_end == end


def test_subscription_cancellation_keeps_current_access_and_is_idempotent(client_and_session, monkeypatch):
    from app.routes import subscription_account
    from app.models import Usuario
    from app.security import get_current_user
    client, Session = client_and_session
    protocol = client.post('/api/contracts/accept', json=_contract_payload()).json()['protocol']
    client.post(f'/api/contracts/{protocol}/billing/setup', json={'payment_method_type':'credit_card','card_token_id':'test-token'})
    with Session() as db:
        user = db.query(Usuario).filter(Usuario.email.like('sandbox-%')).one()
        db.expunge(user)
    client.app.include_router(subscription_account.router)
    client.app.dependency_overrides[get_current_user] = lambda: user
    calls=[]
    monkeypatch.setattr(default_saas_mp_service,'cancel_preapproval',lambda key: calls.append(key) or {'status':'cancelled'})
    assert client.get('/api/subscription').json()['subscription']['canCancel']
    first=client.post('/api/subscription/cancel'); assert first.status_code==200, first.text
    second=client.post('/api/subscription/cancel'); assert second.status_code==200
    assert len(calls)==1
    assert first.json()['paidUntil']==second.json()['paidUntil']


def test_card_network_timeout_recovers_without_creating_second_mandate(client_and_session, monkeypatch):
    from app.services.saas_mercadopago import SaasMercadoPagoError
    client, Session = client_and_session
    protocol = client.post('/api/contracts/accept', json=_contract_payload()).json()['protocol']
    calls=[]
    def uncertain(**kwargs):
        calls.append(kwargs)
        raise SaasMercadoPagoError('connection lost after provider accepted')
    monkeypatch.setattr(default_saas_mp_service,'create_preapproval',uncertain)
    payload={'payment_method_type':'credit_card','card_token_id':'one-time-token'}
    assert client.post(f'/api/contracts/{protocol}/billing/setup',json=payload).status_code==402
    monkeypatch.setattr(default_saas_mp_service,'find_preapproval',lambda *args: {'id':'recovered-mandate','status':'authorized','external_reference':protocol,'auto_recurring':{'transaction_amount':209,'currency_id':'BRL'}})
    recovered=client.post(f'/api/contracts/{protocol}/billing/setup',json=payload)
    assert recovered.status_code==200, recovered.text
    assert len(calls)==1
    with Session() as db: assert db.query(SaaSSubscription).count()==1


def test_private_resume_header_is_allowed_by_production_cors():
    from app.main import app
    from fastapi.testclient import TestClient
    response=TestClient(app).options('/api/signups/current',headers={'Origin':'https://app.komafood.com.br','Access-Control-Request-Method':'PUT','Access-Control-Request-Headers':'content-type,x-signup-token'})
    assert response.status_code==200, response.text
    assert 'x-signup-token' in response.headers['access-control-allow-headers'].lower()
