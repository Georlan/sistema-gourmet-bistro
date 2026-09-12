import datetime as dt
import json
import pytest
from sqlalchemy import text
from app.routes import signups, saas_billing, auth
from app.routes.super_admin import get_current_admin
from app.config import settings
from app.models import Restaurante, Usuario
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
    client.app.include_router(auth.router)
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


def test_authorized_card_waits_for_manual_release_and_notifies_owner(client_and_session, monkeypatch):
    client, Session = client_and_session
    monkeypatch.setattr(settings, 'KOMA_SAAS_MANUAL_RELEASE_REQUIRED', True)
    monkeypatch.setattr(settings, 'KOMA_OWNER_EMAIL', 'owner@example.com')
    monkeypatch.setenv('KOMA_OWNER_WHATSAPP_PHONE', '5585999999999')
    protocol = client.post('/api/contracts/accept', json=_contract_payload()).json()['protocol']

    response = client.post(
        f'/api/contracts/{protocol}/billing/setup',
        json={'payment_method_type':'credit_card','card_token_id':'test-token'},
    )

    assert response.status_code == 200, response.text
    assert response.json()['status'] == 'awaiting_release'
    assert response.json().get('restaurantId') is None
    with Session() as db:
        assert db.query(Restaurante).count() == 0
        setup = db.query(SaaSBillingSetup).one()
        assert setup.status == 'ready'
        assert setup.restaurante_id is None
        releases = db.query(SignupNotification).filter(SignupNotification.id.like(f'{protocol}:release-required:%')).all()
        assert {item.id.rsplit(':', 1)[-1] for item in releases} == {'email', 'whatsapp'}


def test_approved_pix_waits_for_manual_release(client_and_session, monkeypatch):
    client, Session = client_and_session
    monkeypatch.setattr(settings, 'KOMA_SAAS_MANUAL_RELEASE_REQUIRED', True)
    protocol = client.post('/api/contracts/accept', json=_contract_payload('pocket','anual')).json()['protocol']
    payment_id = client.post(
        f'/api/contracts/{protocol}/billing/setup', json={'payment_method_type':'pix'}
    ).json()['paymentId']
    monkeypatch.setattr(default_saas_mp_service, 'verify_webhook_signature', lambda **kwargs: True)
    monkeypatch.setattr(default_saas_mp_service, 'get_payment', lambda key: _verified_pix_payment(key, protocol))

    response = client.post(
        '/api/integrations/saas-billing/mercado-pago/webhook',
        json={'type':'payment', 'data':{'id':payment_id}},
    )

    assert response.status_code == 200, response.text
    assert response.json()['releaseStatus'] == 'awaiting_release'
    assert response.json()['activated'] is False
    with Session() as db:
        setup = db.query(SaaSBillingSetup).one()
        assert setup.status == 'ready'
        assert setup.restaurante_id is None
        assert db.query(Restaurante).count() == 0


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


def test_expired_failed_delivery_erases_private_payload(signup_client, monkeypatch):
    client, Session = signup_client
    client.post('/api/contracts/accept', json=_contract_payload())
    with Session() as db:
        db.query(SignupNotification).update({'status':'failed','expires_at':dt.datetime.now(dt.timezone.utc)-dt.timedelta(seconds=1)})
        db.commit()
    monkeypatch.setattr(signup_notifications,'SessionLocal',Session)
    signup_notifications.dispatch_batch()
    with Session() as db:
        assert all(row.payload_encrypted == '' and row.last_error == 'expired' for row in db.query(SignupNotification))


def test_superadmin_releases_awaiting_contract_provisions_and_schedules_trial(signup_client, monkeypatch):
    from app.models import Usuario
    from app.routes.super_admin import get_current_admin
    client, Session = signup_client
    monkeypatch.setattr(settings, 'KOMA_SAAS_MANUAL_RELEASE_REQUIRED', True)
    monkeypatch.setattr(settings, 'KOMA_OWNER_EMAIL', 'owner@example.com')

    protocol = client.post('/api/contracts/accept', json=_contract_payload()).json()['protocol']

    # Setup de cartão aguardando liberação manual
    setup_res = client.post(
        f'/api/contracts/{protocol}/billing/setup',
        json={'payment_method_type': 'credit_card', 'card_token_id': 'test-token'},
    )
    assert setup_res.status_code == 200
    assert setup_res.json()['status'] == 'awaiting_release'
    with Session() as db:
        assert db.query(Restaurante).count() == 0

    # Liberação pelo SuperAdmin
    client.app.dependency_overrides[get_current_admin] = lambda: {'user': 'super_operator'}
    sync_calls = []
    monkeypatch.setattr(
        default_saas_mp_service,
        'update_preapproval_next_payment_date',
        lambda sub_id, date: sync_calls.append((sub_id, date)) or {'id': sub_id, 'next_payment_date': date.isoformat()},
    )

    release_res = client.post(
        f'/api/super-admin/signups/{protocol}/release',
        json={'reason': 'Liberação manual de homologação'},
    )
    assert release_res.status_code == 200, release_res.text
    release_data = release_res.json()
    assert release_data['success'] is True
    assert release_data['status'] == 'activated'
    assert release_data['restaurant_id']
    assert release_data['invitation_token']
    assert len(sync_calls) == 1

    # Confirma criação do restaurante, do admin pendente e dos 7 dias grátis
    with Session() as db:
        rest = db.query(Restaurante).filter(Restaurante.id == int(release_data['restaurant_id'])).one()
        assert rest.saas_status == 'active'
        sub = db.query(SaaSSubscription).filter(SaaSSubscription.restaurante_id == rest.id).one()
        assert sub.status == 'trialing'
        diff_days = (sub.trial_ends_at - sub.trial_started_at).days
        assert diff_days == 7

        admin_user = db.query(Usuario).filter(Usuario.restaurante_id == rest.id).one()
        assert admin_user.status == 'pendente_ativacao'
        assert admin_user.cargo == 'admin'
        assert admin_user.token_convite == release_data['invitation_token']

        # Confirma mensagens na outbox de e-mail e WhatsApp
        outbox = db.query(SignupNotification).filter(SignupNotification.id.like(f'{protocol}:activation:%')).all()
        assert {item.id.rsplit(':', 1)[-1] for item in outbox} == {'email', 'whatsapp'}

    # Conclui primeiro acesso criando senha via /auth/ativar
    ativar_res = client.post(
        '/auth/ativar',
        json={
            'token_convite': release_data['invitation_token'],
            'email': release_data['admin_email'],
            'senha': 'NovaSenhaSegura123#',
        },
    )
    assert ativar_res.status_code == 200, ativar_res.text
    assert ativar_res.json()['access_token']
    assert ativar_res.json()['usuario']['status'] == 'ativo'


def test_superadmin_release_rejects_pending_or_unpaid_signup(signup_client):
    from app.routes.super_admin import get_current_admin
    client, Session = signup_client
    protocol = client.post('/api/contracts/accept', json=_contract_payload()).json()['protocol']

    client.app.dependency_overrides[get_current_admin] = lambda: {'user': 'operator'}
    res = client.post(f'/api/super-admin/signups/{protocol}/release')
    assert res.status_code == 409
    assert 'ready' in res.json()['detail']


def test_superadmin_release_is_idempotent(signup_client, monkeypatch):
    from app.routes.super_admin import get_current_admin
    client, Session = signup_client
    monkeypatch.setattr(settings, 'KOMA_SAAS_MANUAL_RELEASE_REQUIRED', True)
    protocol = client.post('/api/contracts/accept', json=_contract_payload()).json()['protocol']
    client.post(f'/api/contracts/{protocol}/billing/setup', json={'payment_method_type': 'credit_card', 'card_token_id': 'tok'})

    client.app.dependency_overrides[get_current_admin] = lambda: {'user': 'operator'}
    first = client.post(f'/api/super-admin/signups/{protocol}/release').json()
    assert first['idempotent'] is False

    second = client.post(f'/api/super-admin/signups/{protocol}/release').json()
    assert second['idempotent'] is True
    assert second['restaurant_id'] == first['restaurant_id']
    with Session() as db:
        assert db.query(Restaurante).count() == 1

