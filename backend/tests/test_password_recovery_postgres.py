"""Atomic recovery and tenant isolation with the restricted PostgreSQL runtime."""
import os
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.database import SessionLocal, tenant_session_scope
from app.main import app
from app.models import Cliente, Restaurante
from app.routes.password_recovery import request_limiter
from app.security import get_password_hash, verify_password
from app.services.password_recovery import issue_recovery_token

pytestmark = pytest.mark.skipif(os.getenv('KOMA_PYTEST_USE_EXTERNAL_DATABASE') != 'true', reason='Requires isolated PostgreSQL runtime')


def test_parallel_recovery_is_single_use_and_tenant_scoped():
    admin_engine = create_engine(os.environ['MIGRATION_DATABASE_URL'])
    factory = sessionmaker(bind=admin_engine)
    with factory() as db:
        for rid in (88931, 88932):
            db.add(Restaurante(id=rid, nome='Recovery test', slug=f'recovery-{rid}', plano='pro'))
            db.flush()
            db.add(Cliente(id=f'recovery-{rid}', restaurante_id=rid, nome='Cliente', telefone='11999999999', email='recovery@example.test', senha_hash=get_password_hash('old-password')))
        db.commit()
        account = db.query(Cliente).filter(Cliente.id == 'recovery-88931').one()
        token = issue_recovery_token(account, 'customer')
    try:
        request_limiter.history.clear()
        def reset(_):
            client = TestClient(app)
            return client.post('/auth/password-recovery/confirm', json={'token': token, 'password': 'new-password'}).status_code
        with ThreadPoolExecutor(max_workers=2) as executor:
            assert sorted(executor.map(reset, range(2))) == [200, 400]
        with SessionLocal() as db, tenant_session_scope(db, 88931):
            assert verify_password('new-password', db.get(Cliente, 'recovery-88931').senha_hash)
            # Raw SQL exercises RLS rather than the ORM tenant filter.
            assert db.execute(text('SELECT count(*) FROM clientes WHERE restaurante_id = 88932')).scalar() == 0
        with SessionLocal() as db, tenant_session_scope(db, 88932):
            assert verify_password('old-password', db.get(Cliente, 'recovery-88932').senha_hash)
    finally:
        with factory() as db:
            db.query(Cliente).filter(Cliente.restaurante_id.in_([88931, 88932])).delete(synchronize_session=False)
            db.query(Restaurante).filter(Restaurante.id.in_([88931, 88932])).delete(synchronize_session=False)
            db.commit()
        admin_engine.dispose()
