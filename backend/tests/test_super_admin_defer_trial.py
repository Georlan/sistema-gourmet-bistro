from fastapi.testclient import TestClient
from app.main import app
from app.security import create_access_token
from app.database import SessionLocal
from app.models import Restaurante, Usuario, SuperAdminAuditLog
from app.routes.super_admin_onboarding import restaurant_trials

client = TestClient(app)

def test_provision_tenant_defer_trial(monkeypatch):
    username = "owner-defer-test@example.test"
    monkeypatch.setenv("SUPERADMIN_USERNAME", username)
    token = create_access_token(
        subject=username,
        restaurante_id=0,
        role="superadmin",
    )
    headers = {"Authorization": f"Bearer {token}"}

    payload = {
        "name": "JE Lanches Test Defer",
        "subdomain": "je-lanches-test-defer",
        "plan": "pocket",
        "admin_name": "Admin Provisorio",
        "admin_email": "provisorio@koma.test",
        "temporary_password": "senha_segura_123",
        "defer_trial": True,
    }

    response = client.post("/api/super-admin/restaurantes/provisionar", json=payload, headers=headers)
    assert response.status_code == 201, response.text
    data = response.json()
    tenant_id = int(data["id"])

    try:
        assert data["trial"]["status"] == "pending_setup"
        assert data["trial"]["startedAt"] is None
        assert data["trial"]["endsAt"] is None

        with SessionLocal() as db:
            trial_row = db.execute(
                restaurant_trials.select().where(restaurant_trials.c.restaurante_id == tenant_id)
            ).mappings().one_or_none()
            assert trial_row is None, "Nenhum trial deve ser criado no banco com defer_trial=True"

            restaurante = db.query(Restaurante).filter_by(id=tenant_id).first()
            assert restaurante is not None
            assert restaurante.plano == "pocket"
            assert restaurante.saas_status == "active"
    finally:
        with SessionLocal() as db:
            from sqlalchemy import text
            for table_name in (
                "super_admin_audit_logs",
                "usuarios",
                "configuracoes_restaurante",
                "restaurant_trials",
                "restaurante_operation_profiles",
            ):
                db.execute(
                    text(f"DELETE FROM {table_name} WHERE restaurante_id = :tenant_id"),
                    {"tenant_id": tenant_id},
                )
            db.execute(
                text("DELETE FROM restaurantes WHERE id = :tenant_id"),
                {"tenant_id": tenant_id},
            )
            db.commit()
