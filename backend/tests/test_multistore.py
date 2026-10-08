import datetime
from sqlalchemy import text
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.database import Base, engine, SessionLocal, tenant_session_scope
from app.models import Restaurante, Usuario, RestaurantNetwork, RestaurantNetworkUnit, RestaurantNetworkAccess, SuperAdminAuditLog
from app.routes import super_admin
from app.security import create_access_token, get_password_hash

client = TestClient(app)
A, B, C = 88515, 88516, 88517

@pytest.fixture(autouse=True)
def setup(monkeypatch):
    monkeypatch.setenv('SUPERADMIN_USERNAME', 'network-owner@example.test')
    monkeypatch.setenv('SUPERADMIN_PASSWORD_HASH', get_password_hash('network-test-password'))
    Base.metadata.create_all(engine)
    for rid in (A, B, C):
        with SessionLocal() as db, tenant_session_scope(db, rid):
            db.add(Restaurante(id=rid, nome=f'Loja {rid}', plano='pro'))
            db.add(Usuario(id=f'network-admin-{rid}', nome=f'Gestor {rid}', cargo='admin', status='ativo', restaurante_id=rid, email=f'network-{rid}@example.test'))
            db.commit()
    yield
    # Source grants must be removed before their cross-tenant user FKs.
    for rid in (A, B, C):
        with SessionLocal() as db, tenant_session_scope(db, rid):
            db.query(RestaurantNetworkAccess).filter_by(restaurante_id=rid).delete(); db.commit()
    for rid in (A, B, C):
        with SessionLocal() as db, tenant_session_scope(db, rid):
            db.query(RestaurantNetworkUnit).filter_by(restaurante_id=rid).delete(); db.commit()
    for rid in (A, B, C):
        with SessionLocal() as db, tenant_session_scope(db, rid):
            db.query(RestaurantNetwork).filter_by(restaurante_id=rid).delete()
            db.query(SuperAdminAuditLog).filter_by(restaurante_id=rid).delete()
            db.execute(text('DELETE FROM user_session_versions WHERE restaurante_id=:rid'), {'rid': rid})
            db.query(Usuario).filter_by(restaurante_id=rid).delete()
            db.query(Restaurante).filter_by(id=rid).delete(); db.commit()


def headers(rid=A):
    return {'Authorization': 'Bearer ' + create_access_token(f'network-admin-{rid}', rid, token_version=1)}

def admin_headers():
    return {'Authorization': 'Bearer ' + create_access_token('network-owner@example.test', 0, role='superadmin')}

def make_network(owner=A, member=B):
    response = client.post('/api/super-admin/multistore/networks', headers=admin_headers(), json={'owner_id': owner, 'nome': 'Rede teste', 'reason': 'Propriedade verificada'})
    assert response.status_code == 200, response.text
    net = response.json()
    response = client.put(f'/api/super-admin/multistore/units/{member}', headers=admin_headers(), json={'network_id': net['id'], 'owner_id': owner, 'reason': 'Propriedade verificada'})
    assert response.status_code == 200, response.text
    return net

def grant(source=A, target=B):
    response = client.post(f'/api/super-admin/multistore/units/{source}/accesses', headers=admin_headers(), json={'user_id': f'network-admin-{source}', 'target_id': target, 'target_user_id': f'network-admin-{target}', 'reason': 'Identidades verificadas'})
    assert response.status_code == 200, response.text
    return response.json()


def test_independent_store_has_no_destination_or_token():
    response = client.get('/auth/lojas', headers=headers())
    assert response.status_code == 200, response.text
    assert response.json() == {'current': {'id': A, 'nome': f'Loja {A}'}, 'network': None, 'units': []}
    assert client.post(f'/auth/lojas/{B}/entrar', headers=headers()).status_code == 403


def test_network_alone_does_not_grant_operator_access():
    make_network()
    index = client.get('/auth/lojas', headers=headers()).json()
    assert index['network']['nome'] == 'Rede teste'
    assert index['units'] == []
    assert client.post(f'/auth/lojas/{B}/entrar', headers=headers()).status_code == 403


def test_explicit_access_switches_exact_user_without_password_and_is_directional():
    make_network(); grant()
    response = client.get('/auth/lojas', headers=headers())
    assert response.json()['units'] == [{'id': B, 'nome': f'Loja {B}'}]
    response = client.post(f'/auth/lojas/{B}/entrar', headers=headers())
    assert response.status_code == 200, response.text
    data = response.json()
    assert data['usuario']['id'] == f'network-admin-{B}'
    assert data['usuario']['restaurante_id'] == B
    target_headers = {'Authorization': 'Bearer ' + data['access_token']}
    assert client.get('/auth/lojas', headers=target_headers).json()['current']['id'] == B
    assert client.post(f'/auth/lojas/{A}/entrar', headers=target_headers).status_code == 403
    grant(B, A)
    assert client.post(f'/auth/lojas/{A}/entrar', headers=target_headers).status_code == 200


def test_unrelated_store_and_wrong_destination_identity_are_rejected():
    make_network()
    payload = {'user_id': f'network-admin-{A}', 'target_id': C, 'target_user_id': f'network-admin-{C}', 'reason': 'Verificacao teste'}
    assert client.post(f'/api/super-admin/multistore/units/{A}/accesses', headers=admin_headers(), json=payload).status_code == 403
    payload.update(target_id=B, target_user_id=f'network-admin-{C}')
    assert client.post(f'/api/super-admin/multistore/units/{A}/accesses', headers=admin_headers(), json=payload).status_code == 403
    assert client.post(f'/auth/lojas/{C}/entrar', headers=headers()).status_code == 403


@pytest.mark.parametrize('change', ['inactive', 'removed', 'role', 'suspended'])
def test_revoked_target_state_is_rechecked_on_every_switch(change):
    make_network(); grant()
    with SessionLocal() as db, tenant_session_scope(db, B):
        user = db.query(Usuario).filter_by(id=f'network-admin-{B}').one()
        if change == 'inactive': user.status = 'inativo'
        if change == 'removed': user.removed_at = datetime.datetime.now(datetime.timezone.utc)
        if change == 'role': user.cargo = 'caixa'
        if change == 'suspended': db.query(Restaurante).filter_by(id=B).one().saas_status = 'suspended'
        db.commit()
    assert client.get('/auth/lojas', headers=headers()).json()['units'] == []
    assert client.post(f'/auth/lojas/{B}/entrar', headers=headers()).status_code == 403


def test_revoke_grant_invalidates_previously_issued_target_token():
    make_network(); access = grant()
    token = client.post(f'/auth/lojas/{B}/entrar', headers=headers()).json()['access_token']
    response = client.request('DELETE', f"/api/super-admin/multistore/units/{A}/accesses/{access['id']}", headers=admin_headers(), json={'reason': 'Acesso encerrado'})
    assert response.status_code == 200, response.text
    assert client.get('/auth/lojas', headers={'Authorization': f'Bearer {token}'}).status_code == 401
    assert client.post(f'/auth/lojas/{B}/entrar', headers=headers()).status_code == 403


def test_normal_operator_cannot_administer_networks():
    assert client.post('/api/super-admin/multistore/networks', headers=headers(), json={'owner_id': A, 'nome': 'Rede', 'reason': 'Criacao teste'}).status_code == 403
    with SessionLocal() as db, tenant_session_scope(db, A):
        db.query(Usuario).filter_by(id=f'network-admin-{A}').one().cargo = 'caixa'; db.commit()
    assert client.get('/auth/lojas', headers=headers()).status_code == 403


def test_ids_unchanged_and_unit_cannot_join_another_network():
    make_network()
    net = client.post('/api/super-admin/multistore/networks', headers=admin_headers(), json={'owner_id': C, 'nome': 'Outra rede', 'reason': 'Propriedade verificada'}).json()
    response = client.put(f'/api/super-admin/multistore/units/{B}', headers=admin_headers(), json={'network_id': net['id'], 'owner_id': C, 'reason': 'Transferencia teste'})
    assert response.status_code == 409
    for rid in (A, B, C):
        assert client.get('/auth/lojas', headers=headers(rid)).json()['current']['id'] == rid
    with SessionLocal() as db, tenant_session_scope(db, A):
        assert db.query(SuperAdminAuditLog).filter_by(action='multistore.network.create').count() == 1
