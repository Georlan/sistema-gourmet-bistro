from contextlib import contextmanager
from types import SimpleNamespace

from app.routes import onboarding, super_admin_incidents as routes
from app.services.incident_service import IncidentItem, IncidentSeverity, IncidentSource


def snapshot(blockers):
    return {"readiness": {"blockers": blockers}, "onboarding": {"releaseState": "configuring" if blockers else "released"}}


def incident(tenant=1, severity=IncidentSeverity.CRITICAL):
    return IncidentItem(id=f"outbox-{tenant}", tenant_id=tenant, tenant_name=f"Tenant {tenant}", source=IncidentSource.OUTBOX,
                        severity=severity, title="Falha detectada", detail="Falha persistida", evidence={"event_id": "42"},
                        detected_at="2026-10-03T12:00:00Z", recommended_action="Consultar incidente")


def test_attention_priorities_preserve_unknown_sources_and_canonical_blockers():
    item = routes._attention_item(1, None, [incident()], ["onboarding"])
    assert item["priority"] == "critical"
    assert item["unavailable_sources"] == ["onboarding"]
    assert item["primary_incident"]["id"] == "outbox-1"
    assert routes._attention_item(1, snapshot([]), [], ["incidents"])["priority"] == "unverified"
    blocked = routes._attention_item(1, snapshot(["delivery_configuration", "trial"]), [], ["incidents"])
    assert blocked["priority"] == "blocked"
    assert blocked["blockers"] == ["delivery_configuration", "trial"]
    assert routes._attention_item(1, snapshot([]), [], [])["priority"] == "no_attention"
    assert routes._attention_item(1, snapshot([]), [incident(severity=IncidentSeverity.MEDIUM)], [])["priority"] == "incident"


def test_attention_uses_each_tenant_scope_and_continues_after_source_failure(monkeypatch):
    sessions, scopes = [], []

    class Session:
        def __init__(self):
            self.closed, self.rolled_back, self.tenant = False, False, None
            sessions.append(self)
        def close(self): self.closed = True
        def rollback(self): self.rolled_back = True

    @contextmanager
    def scope(db, tenant):
        scopes.append(tenant)
        db.tenant = tenant
        yield
        db.tenant = None

    def readiness(db, *, current_user):
        assert current_user.is_support_mode is False
        if db.tenant == 2: raise RuntimeError("private query failure")
        return snapshot(["catalog"] if db.tenant == 1 else [])

    def diagnose(db, *, tenant_ids):
        assert len(tenant_ids) == 1
        return [incident(2)] if tenant_ids == [2] else []

    monkeypatch.setattr(routes, "SessionLocal", Session)
    monkeypatch.setattr(routes, "_discover_restaurant_ids", lambda db: [1, 2, 3])
    monkeypatch.setattr(routes, "tenant_session_scope", scope)
    monkeypatch.setattr(onboarding, "_build_onboarding_status", readiness)
    monkeypatch.setattr(routes, "diagnose_all_incidents", diagnose)
    result = routes.get_operational_attention(admin={"user": "owner"})
    assert scopes == [1, 2, 3]
    assert all(db.closed for db in sessions)
    assert [item["tenant_id"] for item in result["items"]] == ["2", "1", "3"]
    assert result["items"][0]["unavailable_sources"] == ["onboarding"]
    assert "private query failure" not in str(result)
    assert sessions[2].rolled_back
