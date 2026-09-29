import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event

from app.database import SessionLocal, tenant_session_scope
from app.main import app
from app.models import Restaurante, SuperAdminAuditLog
from app.routes.super_admin import get_current_admin
from app.smartpos_models import RestauranteCapability

client = TestClient(app)


@pytest.fixture()
def restaurants():
    db = SessionLocal()
    ids = [961301, 961302]
    try:
        for tenant_id in ids:
            with tenant_session_scope(db, tenant_id):
                db.add(Restaurante(id=tenant_id, nome='Benefícios', slug=f'benefits-{uuid.uuid4().hex}', plano='pocket'))
                db.commit()
        yield ids
    finally:
        db.rollback()
        for tenant_id in ids:
            with tenant_session_scope(db, tenant_id):
                db.query(RestauranteCapability).filter_by(restaurante_id=tenant_id).delete()
                db.query(SuperAdminAuditLog).filter_by(restaurante_id=tenant_id).delete()
                db.query(Restaurante).filter_by(id=tenant_id).delete()
                db.commit()
        db.close()


def authorize():
    app.dependency_overrides[get_current_admin] = lambda: {'user': 'owner@example.test', 'role': 'superadmin'}


def url(tenant_id, capability=None):
    base = f'/api/super-admin/restaurantes/{tenant_id}/capabilities'
    return f'{base}/{capability}' if capability else base


def test_grant_revoke_baseline_preserves_plan_and_audits_tenant(restaurants):
    authorize()
    a, b = restaurants
    assert client.get(url(a)).json()['baseline']['printing'] is False
    for mode, expected in [('grant', True), ('revoke', False), ('baseline', False)]:
        response = client.patch(url(a, 'printing'), json={'mode': mode, 'reason': 'Primeiro cliente KÔMA; extra R$ 0'})
        assert response.status_code == 200, response.text
        body = response.json()
        assert body['plan'] == 'pocket'
        assert body['baseline']['printing'] is False
        assert body['effective']['printing'] is expected
        assert ('printing' in body['overrides']) is (mode != 'baseline')
    assert client.get(url(b)).json()['effective']['printing'] is False
    db = SessionLocal()
    try:
        with tenant_session_scope(db, a):
            logs = db.query(SuperAdminAuditLog).filter_by(restaurante_id=a, action='SUPERADMIN_CAPABILITY_UPDATE').order_by(SuperAdminAuditLog.id).all()
            assert len(logs) == 3
            assert all(log.actor == 'owner@example.test' for log in logs)
            assert all(log.reason == 'Primeiro cliente KÔMA; extra R$ 0' for log in logs)
            assert logs[0].before_data['effective']['printing'] is False
            assert logs[0].after_data['effective']['printing'] is True
            assert db.query(Restaurante).filter_by(id=a).one().plano == 'pocket'
        with tenant_session_scope(db, b):
            assert db.query(SuperAdminAuditLog).filter_by(restaurante_id=b).count() == 0
    finally:
        db.close()


def test_requires_auth_valid_reason_resource_and_tenant(restaurants):
    a, _ = restaurants
    assert client.get(url(a)).status_code == 401
    assert client.patch(url(a, 'printing'), json={'mode': 'grant', 'reason': 'valid'}).status_code == 401
    authorize()
    for reason in ['', '  ', ' a ']:
        assert client.patch(url(a, 'printing'), json={'mode': 'grant', 'reason': reason}).status_code == 422
    assert client.patch(url(a, 'smartpos'), json={'mode': 'grant', 'reason': 'valid'}).status_code == 422
    assert client.patch(url(a, 'printing'), json={'mode': 'grant', 'reason': 'valid', 'plan': 'pro'}).status_code == 422
    assert client.get(url('invalid')).status_code == 422
    assert client.get(url(99999991)).status_code == 404
    assert client.patch(url(99999991, 'printing'), json={'mode': 'grant', 'reason': 'valid'}).status_code == 404
    assert client.get(url(a)).json()['overrides'] == {}


def test_audit_failure_rolls_back_benefit(restaurants):
    authorize()
    a, _ = restaurants
    def fail_audit(mapper, connection, target):
        if target.action == 'SUPERADMIN_CAPABILITY_UPDATE':
            raise RuntimeError('audit unavailable')
    event.listen(SuperAdminAuditLog, 'before_insert', fail_audit)
    try:
        with TestClient(app, raise_server_exceptions=False) as failing_client:
            response = failing_client.patch(url(a, 'printing'), json={'mode': 'grant', 'reason': 'valid reason'})
        assert response.status_code == 500
    finally:
        event.remove(SuperAdminAuditLog, 'before_insert', fail_audit)
    assert client.get(url(a)).json()['overrides'] == {}
