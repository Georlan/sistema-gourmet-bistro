import datetime as dt
from decimal import Decimal
import pytest
from fastapi.testclient import TestClient
from app.database import SessionLocal, engine, tenant_session_scope
from app.main import app
from app.models import DirectPixFeeInvoice, Restaurante
from app.routes.super_admin import get_current_admin
from app.routes.super_admin_finance import COST_CATEGORIES
from app.super_admin_finance_models import FinanceBase, OwnerFinanceAudit, OwnerFinanceMonth

client = TestClient(app)


def test_finance_migration_keeps_one_deployment_head():
    from pathlib import Path
    from alembic.config import Config
    from alembic.script import ScriptDirectory
    scripts = ScriptDirectory.from_config(Config(str(Path(__file__).resolve().parents[1] / 'alembic.ini')))
    heads = scripts.get_heads()
    assert len(heads) == 1
    assert '5f6a7b8c9d01' in {revision.revision for revision in scripts.iterate_revisions(heads[0], 'c7d8e9f0a123')}


@pytest.fixture(autouse=True)
def clear_finance_admin_override():
    previous = app.dependency_overrides.pop(get_current_admin, None)
    yield
    app.dependency_overrides.pop(get_current_admin, None)
    if previous is not None:
        app.dependency_overrides[get_current_admin] = previous


@pytest.fixture()
def finance_data():
    FinanceBase.metadata.create_all(engine)
    with SessionLocal() as db:
        for tenant_id in (965901, 965902):
            with tenant_session_scope(db, tenant_id):
                db.add(Restaurante(id=tenant_id, nome='Finance QA', slug=f'finance-qa-{tenant_id}'))
                db.commit()
                db.add(DirectPixFeeInvoice(id=f'finance-{tenant_id}', restaurante_id=tenant_id, period='2098-11', fees=Decimal('4.50'), subscription_amount=Decimal('39'), status='paid', paid_at=dt.datetime(2098, 11, 2, tzinfo=dt.timezone.utc)))
                db.commit()
        with tenant_session_scope(db, 965901):
            db.add(DirectPixFeeInvoice(id='finance-open', restaurante_id=965901, period='2098-12', fees=Decimal('2'), subscription_amount=Decimal('39'), status='open'))
            db.add(DirectPixFeeInvoice(id='finance-boundary', restaurante_id=965901, period='2098-10', fees=Decimal('0'), subscription_amount=Decimal('100'), status='paid', paid_at=dt.datetime(2098, 12, 1, 2, 59, tzinfo=dt.timezone.utc)))
            db.commit()
    yield
    with SessionLocal() as db:
        for tenant_id in (965901, 965902):
            with tenant_session_scope(db, tenant_id):
                db.query(DirectPixFeeInvoice).filter_by(restaurante_id=tenant_id).delete()
                db.query(Restaurante).filter_by(id=tenant_id).delete()
                db.commit()
        db.query(OwnerFinanceAudit).filter_by(period='2098-11').delete()
        db.query(OwnerFinanceMonth).filter_by(period='2098-11').delete()
        db.commit()


def authorize():
    app.dependency_overrides[get_current_admin] = lambda: {'user': 'owner@qa.test', 'role': 'superadmin'}


def test_received_dates_cost_unknown_and_audit(finance_data):
    authorize()
    body = client.get('/api/super-admin/finance?period=2098-11').json()
    assert Decimal(body['received']) == Decimal('187')
    assert Decimal(body['outstanding']) == 0
    assert body['recorded_result'] is None
    costs = {key: '0.00' for key in COST_CATEGORIES}
    costs['chatgpt'] = '120.00'; costs['database'] = None
    response = client.put('/api/super-admin/finance/costs/2098-11', json={'costs': costs, 'reason': 'Faturas conferidas'})
    assert response.status_code == 200, response.text
    body = client.get('/api/super-admin/finance?period=2098-11').json()
    assert body['unknown_costs'] == ['database']
    assert body['recorded_result'] is None
    costs['database'] = '25.00'
    assert client.put('/api/super-admin/finance/costs/2098-11', json={'costs': costs, 'reason': 'Banco conferido'}).status_code == 200
    assert Decimal(client.get('/api/super-admin/finance?period=2098-11').json()['recorded_result']) == Decimal('42')
    december = client.get('/api/super-admin/finance?period=2098-12').json()
    assert Decimal(december['received']) == 0
    assert Decimal(december['outstanding']) == 41
    with SessionLocal() as db:
        logs = db.query(OwnerFinanceAudit).filter_by(period='2098-11').all()
        assert len(logs) == 2
        assert all(row.actor == 'owner@qa.test' for row in logs)
        assert logs[0].before_data is None
        assert logs[1].before_data['database'] is None


def test_auth_invalid_month_and_costs(finance_data):
    assert client.get('/api/super-admin/finance?period=2098-11').status_code == 401
    assert client.put('/api/super-admin/finance/costs/2098-11', json={}).status_code == 401
    from app.security import create_access_token
    restaurant_token = create_access_token(subject='restaurant@qa.test', restaurante_id=965901, role='admin')
    headers = {'Authorization': f'Bearer {restaurant_token}'}
    assert client.get('/api/super-admin/finance?period=2098-11', headers=headers).status_code == 403
    assert client.put('/api/super-admin/finance/costs/2098-11', json={}, headers=headers).status_code == 403
    authorize()
    for period in ('2098-13', '2098-00', 'invalid'):
        assert client.get(f'/api/super-admin/finance?period={period}').status_code == 422
    costs = {key: '0.00' for key in COST_CATEGORIES}
    for invalid in ('-1', '0.001', '1000001', 'NaN'):
        assert client.put('/api/super-admin/finance/costs/2098-11', json={'costs': {**costs, 'railway': invalid}, 'reason': 'Conferido'}).status_code == 422
    assert client.put('/api/super-admin/finance/costs/2098-11', json={'costs': {}, 'reason': 'Conferido'}).status_code == 422
    assert client.put('/api/super-admin/finance/costs/2098-11', json={'costs': costs, 'reason': '   '}).status_code == 422
    assert client.put('/api/super-admin/finance/costs/2098-+1', json={'costs': costs, 'reason': 'Conferido'}).status_code == 422
