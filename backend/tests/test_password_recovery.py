import datetime
from unittest.mock import Mock

import jwt
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import settings
from app.database import Base, get_db, tenant_session_scope
from app.models import Cliente, Restaurante, Usuario, PublicRateLimit
from app.session_models import UserSessionVersion
from app.routes import password_recovery as routes
from app.routes.cardapio_clientes import router as customers_router
from app.security import get_password_hash, verify_password
from app.services import password_recovery as recovery
from app.services.customer_auth import create_customer_access_token


@pytest.fixture()
def setup(monkeypatch):
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    for model in (Restaurante, Usuario, Cliente, PublicRateLimit, UserSessionVersion):
        model.__table__.create(engine)
    factory = sessionmaker(bind=engine)
    db = factory()
    for rid in (1, 2):
        db.add(Restaurante(id=rid, nome=f'Restaurante {rid}', slug=f'rest-{rid}', plano='pro'))
        db.add(Cliente(id=f'customer-{rid}', restaurante_id=rid, nome='Cliente', telefone=f'1199999999{rid}', email='customer@example.test', senha_hash=get_password_hash('old-password')))
        db.add(Usuario(id=f'staff-{rid}', restaurante_id=rid, nome='Garçom', email='staff@example.test', status='ativo', role='garcom', cargo='garcom', senha_hash=get_password_hash('old-password')))
    db.add(Restaurante(id=3, nome='Restaurante Inativo', slug='rest-3', plano='pro'))
    db.add(Usuario(id='staff-3', restaurante_id=3, nome='Inativo', email='staff@example.test', status='inativo', role='garcom', cargo='garcom', senha_hash=get_password_hash('old-password')))
    db.add(Cliente(id='guest', restaurante_id=1, nome='Guest', telefone='11988888888', email='guest@example.test'))
    db.commit()

    app = FastAPI()
    app.include_router(routes.router)
    app.include_router(customers_router)

    def get_test_db():
        session = factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = get_test_db
    sent = []

    def capture_single(email, token, restaurant_name):
        sent.append({
            'mode': 'single',
            'email': email,
            'tokens': [token],
            'restaurant_name': restaurant_name,
        })

    def capture_multi(email, options):
        options = list(options)
        sent.append({
            'mode': 'multi',
            'email': email,
            'tokens': [option['token'] for option in options],
            'options': options,
        })

    monkeypatch.setattr(routes, 'send_recovery_email', capture_single)
    monkeypatch.setattr(routes, 'send_staff_recovery_email', capture_multi)
    monkeypatch.setattr(settings, 'PASSWORD_RECOVERY_ENABLED', True)
    monkeypatch.setattr(settings, 'RESEND_API_KEY', 'test-only-placeholder')
    monkeypatch.setattr(settings, 'EMAIL_FROM', 'test@example.test')
    routes.request_limiter.history.clear()
    yield TestClient(app), db, sent
    db.close()
    engine.dispose()


def request(client, kind='customer', email='customer@example.test', rid=1):
    return client.post('/auth/password-recovery/request', json={
        'kind': kind,
        'email': email,
        'restaurante_id': rid,
    })


def confirm(client, token, password='new-password'):
    return client.post('/auth/password-recovery/confirm', json={'token': token, 'password': password})


def test_customer_reset_single_use_and_revokes_sessions(setup):
    client, db, sent = setup
    old_session = create_customer_access_token(cliente_id='customer-1', restaurante_id=1)
    assert request(client).status_code == 202
    token = sent[0]['tokens'][0]
    assert confirm(client, token).status_code == 200
    assert confirm(client, token).status_code == 400
    db.expire_all()
    with tenant_session_scope(db, 1):
        assert verify_password('new-password', db.get(Cliente, 'customer-1').senha_hash)
    with tenant_session_scope(db, 2):
        assert verify_password('old-password', db.get(Cliente, 'customer-2').senha_hash)
    assert client.get('/cardapio/clientes/me', headers={'X-Koma-Customer-Token': old_session}).status_code == 401
    new_session = create_customer_access_token(cliente_id='customer-1', restaurante_id=1)
    assert client.get('/cardapio/clientes/me', headers={'X-Koma-Customer-Token': new_session}).status_code == 200


def test_staff_reset_with_explicit_tenant_revokes_only_that_operational_session(setup):
    client, db, sent = setup
    assert request(client, 'staff', 'staff@example.test', 1).status_code == 202
    assert len(sent) == 1
    assert sent[0]['mode'] == 'single'
    assert confirm(client, sent[0]['tokens'][0]).status_code == 200
    with tenant_session_scope(db, 1):
        assert db.get(UserSessionVersion, 'staff-1').token_version == 2
    with tenant_session_scope(db, 2):
        assert verify_password('old-password', db.get(Usuario, 'staff-2').senha_hash)


def test_staff_recovery_without_tenant_sends_one_mailbox_scoped_message(setup):
    client, db, sent = setup
    response = request(client, 'staff', 'staff@example.test', None)
    assert response.status_code == 202
    assert response.json() == {'message': routes.GENERIC_MESSAGE}
    assert 'Restaurante 1' not in response.text
    assert 'Restaurante 2' not in response.text
    assert 'Inativo' not in response.text

    assert len(sent) == 1
    delivery = sent[0]
    assert delivery['mode'] == 'multi'
    assert [option['restaurant_name'] for option in delivery['options']] == ['Restaurante 1', 'Restaurante 2']

    claims = [recovery.decode_recovery_token(token) for token in delivery['tokens']]
    assert {claim['restaurante_id'] for claim in claims} == {1, 2}
    assert all(claim['kind'] == 'staff' for claim in claims)

    token_rid_2 = next(token for token in delivery['tokens'] if recovery.decode_recovery_token(token)['restaurante_id'] == 2)
    assert confirm(client, token_rid_2).status_code == 200
    with tenant_session_scope(db, 1):
        assert verify_password('old-password', db.get(Usuario, 'staff-1').senha_hash)
    with tenant_session_scope(db, 2):
        assert verify_password('new-password', db.get(Usuario, 'staff-2').senha_hash)
    with tenant_session_scope(db, 3):
        assert verify_password('old-password', db.get(Usuario, 'staff-3').senha_hash)


def test_guest_unknown_and_throttled_have_generic_response(setup):
    client, db, sent = setup
    known = request(client).json()
    assert request(client, email='missing@example.test').json() == known
    assert request(client, email='guest@example.test').json() == known
    for _ in range(4):
        assert request(client).json() == known
    assert len(sent) == 3
    with tenant_session_scope(db, 1):
        assert db.get(Cliente, 'guest').senha_hash is None
        for rate in db.query(PublicRateLimit).all():
            assert 'customer@example.test' not in rate.key_hash


def test_expired_tampered_wrong_purpose_and_wrong_tenant_fail(setup):
    client, db, sent = setup
    request(client)
    token = sent[0]['tokens'][0]
    claims = recovery.decode_recovery_token(token)
    for patch in ({'exp': 1}, {'purpose': 'customer'}, {'restaurante_id': 2}, {'kind': 'staff'}):
        altered = jwt.encode({**claims, **patch}, recovery.recovery_key(), algorithm='HS256')
        assert confirm(client, altered).status_code == 400
    assert confirm(client, token[:-5] + 'abcde').status_code == 400
    customer_session = create_customer_access_token(cliente_id='customer-1', restaurante_id=1)
    assert confirm(client, customer_session).status_code == 400
    assert client.get('/cardapio/clientes/me', headers={'X-Koma-Customer-Token': token}).status_code == 401
    assert confirm(client, token, 'short').status_code == 422


def test_disabled_sender_and_missing_configuration_fail_closed(setup, monkeypatch):
    client, _, sent = setup
    for field, value in [('PASSWORD_RECOVERY_ENABLED', False), ('EMAIL_FROM', ''), ('RESEND_API_KEY', '')]:
        with monkeypatch.context() as patch:
            patch.setattr(settings, field, value)
            assert request(client).status_code == 503
    assert not sent


def test_resend_adapter_uses_configured_sender_and_never_logs_payload(setup, monkeypatch, caplog):
    post = Mock(return_value=Mock(is_success=False, status_code=503))
    monkeypatch.setattr(recovery.httpx, 'post', post)
    recovery.send_recovery_email('private@example.test', 'private-secret', 'Restaurante\n1')
    args, kwargs = post.call_args
    assert args[0] == 'https://api.resend.com/emails'
    assert kwargs['json']['from'] == settings.EMAIL_FROM
    assert kwargs['json']['subject'] == 'KÔMA — recuperar sua senha — Restaurante 1'
    assert kwargs['json']['text'].startswith('Restaurante: Restaurante 1\n\n')
    assert '/recuperar-senha#token=private-secret' in kwargs['json']['text']
    assert 'private' not in caplog.text


def test_multi_tenant_resend_adapter_sends_one_message_with_scoped_links(setup, monkeypatch):
    post = Mock(return_value=Mock(is_success=True, status_code=200))
    monkeypatch.setattr(recovery.httpx, 'post', post)
    recovery.send_staff_recovery_email('staff@example.test', [
        {'restaurant_name': 'Restaurante 1', 'token': 'token-one'},
        {'restaurant_name': 'Restaurante\n2', 'token': 'token-two'},
    ])

    assert post.call_count == 1
    _, kwargs = post.call_args
    payload = kwargs['json']
    assert payload['to'] == ['staff@example.test']
    assert payload['subject'] == 'KÔMA — recuperar sua senha'
    assert 'Restaurante 1:' in payload['text']
    assert 'Restaurante 2:' in payload['text']
    assert '/recuperar-senha#token=token-one' in payload['text']
    assert '/recuperar-senha#token=token-two' in payload['text']
