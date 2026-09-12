"""Exercise the production role, rather than only inspecting migration text."""
import os
import uuid
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import text

pytestmark = pytest.mark.skipif(os.getenv('KOMA_PYTEST_USE_EXTERNAL_DATABASE','false').lower() != 'true', reason='Requires isolated PostgreSQL runtime role')

def test_signup_runtime_capabilities_and_durable_delivery(monkeypatch):
    from app.routes import signups
    from app.routes.super_admin import get_current_admin
    from app.database import SessionLocal
    from app.services import signup_notifications
    app = FastAPI(); app.include_router(signups.router); app.include_router(signups.admin_router,prefix='/api/super-admin')
    app.dependency_overrides[get_current_admin] = lambda: {'user':'test-admin'}
    client=TestClient(app)
    data={'restaurant_name':'PostgreSQL test', 'responsible_name':'Test Admin','email':'test@example.com','phone':'85999999999','plan':'pro','billing_cycle':'mensal'}
    response=client.post('/api/signups',json=data)
    assert response.status_code==201, response.text
    saved=response.json()
    assert client.get('/api/signups/current',headers={'X-Signup-Token':saved['token']}).json()['data']==data
    assert client.get('/api/signups/current',headers={'X-Signup-Token':'z'*43}).status_code==404
    assert client.get('/api/super-admin/signups').status_code==200
    with SessionLocal() as db:
        with pytest.raises(Exception,match='permission denied'):
            db.execute(text('SELECT * FROM public.restaurant_signups'))
        db.rollback()
        signup_notifications.enqueue(db,protocol=saved['id'],kind='test',email='test@example.com',phone=None,subject='Test',message='Test only')
        db.commit()
    monkeypatch.setattr(signup_notifications,'_deliver',lambda *args: None)
    signup_notifications.dispatch_batch()
    rows=client.get('/api/super-admin/signups/deliveries').json()['items']
    assert any(row['id'].startswith(saved['id']) and row['status']=='sent' for row in rows)
