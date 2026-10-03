"""Audit history must not disappear behind another tenant's global window."""
import datetime
from contextlib import contextmanager

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models import Restaurante, SuperAdminAuditLog
from app.routes import super_admin


@pytest.fixture
def audit_db(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Restaurante.__table__.create(engine)
    SuperAdminAuditLog.__table__.create(engine)
    factory = sessionmaker(bind=engine)
    with factory() as db:
        for tenant in (1, 2, 3):
            db.add(Restaurante(id=tenant, nome=f"Tenant {tenant}", slug=f"audit-{tenant}", plano="pro"))
        db.flush()
        for tenant, count in ((1, 105), (2, 100), (3, 100)):
            for i in range(count):
                db.add(SuperAdminAuditLog(
                    id=tenant * 1000 + i, restaurante_id=tenant, actor="operator",
                    action="TEST", reason="Scope regression",
                    created_at=datetime.datetime(2026, 10, tenant, 12) + datetime.timedelta(seconds=i),
                    before_data={"events": [{"token": "private", "status": "pending"}]},
                    after_data={"status": "ready"},
                ))
        db.commit()
    scopes = []

    @contextmanager
    def scope(db, tenant):
        scopes.append(tenant)
        yield

    monkeypatch.setattr(super_admin, "SessionLocal", factory)
    monkeypatch.setattr(super_admin, "tenant_session_scope", scope)
    yield scopes
    engine.dispose()


def test_scoped_history_survives_global_limit_and_keeps_latest_100(audit_db):
    global_logs = super_admin.list_audit_logs(admin={"user": "operator"}, tenant_id=None)
    assert len(global_logs) == 200
    assert not any(log["restauranteId"] == "1" for log in global_logs)
    audit_db.clear()
    logs = super_admin.list_audit_logs(admin={"user": "operator"}, tenant_id=1)
    assert audit_db == [1]
    assert len(logs) == 100
    assert {log["restauranteId"] for log in logs} == {"1"}
    assert logs[0]["id"] == "1104"
    assert logs[-1]["id"] == "1005"
    assert logs[0]["beforeData"]["events"][0] == {"token": "[REDACTED]", "status": "pending"}


def test_unknown_tenant_is_not_reported_as_empty_history(audit_db):
    with pytest.raises(HTTPException) as error:
        super_admin.list_audit_logs(admin={"user": "operator"}, tenant_id=999)
    assert error.value.status_code == 404


def test_sanitization_recurses_through_arrays_without_losing_operational_evidence():
    assert super_admin._sanitize_audit_data([{"nested": [{"password": "private", "job_id": "42"}]}]) == [
        {"nested": [{"password": "[REDACTED]", "job_id": "42"}]}
    ]
