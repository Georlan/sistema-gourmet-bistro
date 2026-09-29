import base64
import datetime as dt
import json
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from svix.webhooks import Webhook

from app.config import settings
from app.database import get_db
from app.routes import resend_webhook
from app.services import email_delivery
from app.services.team_invitations import delivery_id, with_delivery_status
from app.signup_models import SignupBase, EmailDeliveryReceipt, SignupNotification

EMAIL_ID = '773a60a2-2e7d-4236-9b2b-8c46e4c564d8'
SECRET = 'whsec_' + base64.b64encode(b'test-only-secret-of-32-bytes-long!').decode()


@pytest.fixture
def receipt_db():
    engine = create_engine('sqlite://', poolclass=StaticPool, connect_args={'check_same_thread': False})
    SignupBase.metadata.create_all(engine)
    with Session(engine) as db:
        yield db
    engine.dispose()


def test_signed_callbacks_are_idempotent_and_cannot_regress_delivery(receipt_db, monkeypatch):
    monkeypatch.setattr(settings, 'RESEND_WEBHOOK_SECRET', SECRET)
    app = FastAPI()
    app.include_router(resend_webhook.router)
    app.dependency_overrides[get_db] = lambda: receipt_db
    client = TestClient(app)
    now = dt.datetime.now(dt.timezone.utc)

    def send(state, occurred_at=now, signing_time=now, tamper=False):
        payload = json.dumps({'type': 'email.' + state, 'created_at': occurred_at.isoformat(),
            'data': {'email_id': EMAIL_ID, 'to': ['discard@example.test']}})
        signature = Webhook(SECRET).sign('msg-test', signing_time, payload)
        return client.post('/api/webhooks/resend', content=payload + (' ' if tamper else ''), headers={
            'svix-id': 'msg-test', 'svix-timestamp': str(int(signing_time.timestamp())), 'svix-signature': signature})

    assert send('delivered', tamper=True).status_code == 400
    assert send('delivered', signing_time=now - dt.timedelta(minutes=10)).status_code == 400
    assert send('delivered').status_code == 200
    assert send('delivered').status_code == 200
    # Callback can arrive before the provider acceptance is persisted.
    email_delivery.record_acceptance(receipt_db, EMAIL_ID, 'team-2-member:invite:email')
    receipt_db.commit()
    assert send('sent', now + dt.timedelta(seconds=1)).status_code == 200
    assert receipt_db.query(EmailDeliveryReceipt).count() == 1
    receipt_db.expire_all()
    row = receipt_db.get(EmailDeliveryReceipt, EMAIL_ID)
    assert row.status == 'delivered'
    assert row.notification_id == 'team-2-member:invite:email'
    assert send('bounced', now + dt.timedelta(seconds=2)).status_code == 200
    assert send('delivered', now).status_code == 200
    receipt_db.expire_all()
    assert receipt_db.get(EmailDeliveryReceipt, EMAIL_ID).status == 'bounced'


def test_team_invite_reads_delivered_and_rejected_status(receipt_db):
    now = dt.datetime.now(dt.timezone.utc)
    user = SimpleNamespace(id='member', restaurante_id=2, token_convite='token', email='staff@example.test')
    notice_id = delivery_id(user)
    receipt_db.add(SignupNotification(id=notice_id, payload_encrypted='', status='sent', attempts=1,
        next_attempt_at=now, expires_at=now + dt.timedelta(hours=24)))
    email_delivery.record_acceptance(receipt_db, EMAIL_ID, notice_id)
    email_delivery.record_event(receipt_db, EMAIL_ID, 'delivered', now)
    receipt_db.commit()
    assert with_delivery_status(receipt_db, [user], 2)[0].convite_email_status == 'entregue'
    email_delivery.record_event(receipt_db, EMAIL_ID, 'bounced', now + dt.timedelta(seconds=1))
    receipt_db.commit()
    assert with_delivery_status(receipt_db, [user], 2)[0].convite_email_status == 'falhou'


def test_temporary_email_failure_retries_with_same_idempotency_key(monkeypatch):
    calls = []
    responses = iter([httpx.Response(503), httpx.Response(429), httpx.Response(200)])
    def post(*args, **kwargs):
        calls.append(kwargs['headers']['Idempotency-Key'])
        return next(responses)
    monkeypatch.setattr(email_delivery.httpx, 'post', post)
    monkeypatch.setattr(email_delivery.time, 'sleep', lambda _: None)
    assert email_delivery.send_email({'text': 'test'}, 'stable-key', attempts=3).is_success
    assert calls == ['stable-key'] * 3


def test_permanent_email_rejection_is_not_retried(monkeypatch):
    calls = []
    def post(*args, **kwargs):
        calls.append(True)
        return httpx.Response(422)
    monkeypatch.setattr(email_delivery.httpx, 'post', post)
    assert email_delivery.send_email({}, 'stable-key', attempts=3).status_code == 422
    assert len(calls) == 1


def test_webhook_requires_configuration_and_limits_body(receipt_db, monkeypatch):
    app = FastAPI()
    app.include_router(resend_webhook.router)
    app.dependency_overrides[get_db] = lambda: receipt_db
    client = TestClient(app)
    monkeypatch.setattr(settings, 'RESEND_WEBHOOK_SECRET', '')
    assert client.post('/api/webhooks/resend', json={}).status_code == 503
    monkeypatch.setattr(settings, 'RESEND_WEBHOOK_SECRET', SECRET)
    assert client.post('/api/webhooks/resend', content=b'x' * 65537).status_code == 413
    assert receipt_db.query(EmailDeliveryReceipt).count() == 0
