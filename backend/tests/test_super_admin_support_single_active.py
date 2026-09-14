from app.database import SessionLocal, tenant_session_scope
from app.routes import super_admin_support
from app.support_models import SupportSession


def test_starting_new_support_session_supersedes_previous_active_session():
    tenant_id = 1
    admin = {"user": "support-concurrency-regression@example.test"}

    # Garante pré-condição estável mesmo se outro teste deixou sessão ativa.
    super_admin_support.end_support_session(
        str(tenant_id),
        super_admin_support.SupportSessionEndRequest(
            reason="Preparação do teste de sessão única de suporte.",
        ),
        admin=admin,
    )

    first = super_admin_support.start_support_session(
        str(tenant_id),
        super_admin_support.SupportSessionStartRequest(
            reason="Primeira sessão para validar supersessão concorrente.",
            duration_minutes=15,
        ),
        admin=admin,
    )
    second = super_admin_support.start_support_session(
        str(tenant_id),
        super_admin_support.SupportSessionStartRequest(
            reason="Segunda sessão deve substituir a primeira.",
            duration_minutes=15,
        ),
        admin=admin,
    )

    assert first["session_id"] != second["session_id"]

    active = super_admin_support.get_active_support_session(str(tenant_id), admin=admin)
    assert active["active"] is True
    assert active["session"]["id"] == second["session_id"]

    with SessionLocal() as db:
        with tenant_session_scope(db, tenant_id):
            rows = (
                db.query(SupportSession)
                .filter(
                    SupportSession.restaurante_id == tenant_id,
                    SupportSession.id.in_([first["session_id"], second["session_id"]]),
                )
                .all()
            )
            statuses = {row.id: row.status for row in rows}
            active_count = (
                db.query(SupportSession)
                .filter(
                    SupportSession.restaurante_id == tenant_id,
                    SupportSession.status == "active",
                )
                .count()
            )

    assert statuses[first["session_id"]] == "ended"
    assert statuses[second["session_id"]] == "active"
    assert active_count == 1

    super_admin_support.end_support_session(
        str(tenant_id),
        super_admin_support.SupportSessionEndRequest(
            reason="Limpeza do teste de sessão única de suporte.",
        ),
        admin=admin,
    )
