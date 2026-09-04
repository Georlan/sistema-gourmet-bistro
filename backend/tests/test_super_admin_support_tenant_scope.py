from contextlib import contextmanager

from app.routes import super_admin_support


def test_superadmin_support_control_plane_enters_target_tenant_scope(monkeypatch):
    """Super Admin usa tenant 0; tabelas de suporte só podem ser tocadas no tenant alvo.

    Em PostgreSQL, support_sessions e super_admin_audit_logs são protegidas por RLS.
    Este teste evita que start/active/end voltem a operar com a sessão global do
    Super Admin, comportamento que o SQLite não bloquearia por conta própria.
    """
    calls: list[int] = []
    original_scope = super_admin_support.tenant_session_scope

    @contextmanager
    def tracked_scope(db, tenant_id):
        calls.append(int(tenant_id))
        with original_scope(db, tenant_id):
            yield int(tenant_id)

    monkeypatch.setattr(super_admin_support, "tenant_session_scope", tracked_scope)
    admin = {"user": "scope-regression@example.test"}

    started = super_admin_support.start_support_session(
        "1",
        super_admin_support.SupportSessionStartRequest(
            reason="Validação do escopo RLS do modo suporte.",
            duration_minutes=15,
        ),
        admin=admin,
    )
    assert started["restaurant_id"] == 1

    active = super_admin_support.get_active_support_session("1", admin=admin)
    assert active["active"] is True

    ended = super_admin_support.end_support_session(
        "1",
        super_admin_support.SupportSessionEndRequest(
            reason="Fim da validação do escopo RLS.",
        ),
        admin=admin,
    )
    assert ended["closed_count"] >= 1
    assert calls == [1, 1, 1]
