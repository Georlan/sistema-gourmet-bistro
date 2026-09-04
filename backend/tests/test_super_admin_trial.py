import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.database import SessionLocal, tenant_session_scope
from app.main import app
from app.models import SuperAdminAuditLog
from app.routes import super_admin
from app.security import create_access_token, get_password_hash


client = TestClient(app)
SUPERADMIN_USERNAME = "owner-trial@example.test"
SUPERADMIN_PASSWORD = "test-password-not-for-production"


@pytest.fixture(autouse=True)
def superadmin_env(monkeypatch):
    super_admin.superadmin_login_rate_limiter.history.clear()
    monkeypatch.setenv("SUPERADMIN_USERNAME", SUPERADMIN_USERNAME)
    monkeypatch.setenv(
        "SUPERADMIN_PASSWORD_HASH",
        get_password_hash(SUPERADMIN_PASSWORD),
    )
    yield
    super_admin.superadmin_login_rate_limiter.history.clear()


def _superadmin_headers() -> dict[str, str]:
    token = create_access_token(
        subject=SUPERADMIN_USERNAME,
        restaurante_id=0,
        role="superadmin",
    )
    return {"Authorization": f"Bearer {token}"}


def _onboarding_payload() -> dict[str, str]:
    suffix = uuid.uuid4().hex[:10]
    return {
        "name": f"Trial Restaurante {suffix}",
        "subdomain": f"trial-{suffix}",
        "plan": "pro",
        "admin_name": "Admin Trial",
        "admin_email": f"trial-{suffix}@example.test",
        "temporary_password": f"Temp-{suffix}-123!",
    }


def _cleanup_tenant(tenant_id: int | None) -> None:
    if not tenant_id:
        return
    db = SessionLocal()
    try:
        with tenant_session_scope(db, tenant_id):
            for table_name in (
                "restaurant_trials",
                "super_admin_audit_logs",
                "usuarios",
                "configuracoes_restaurante",
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
    finally:
        db.close()


def test_onboarding_concede_sete_dias_sem_criar_cobranca_saas():
    tenant_id = None
    try:
        response = client.post(
            "/api/super-admin/restaurantes",
            headers=_superadmin_headers(),
            json=_onboarding_payload(),
        )
        assert response.status_code == 201, response.text
        body = response.json()
        tenant_id = int(body["id"])

        assert body["status"] == "ACTIVE"
        assert body["onlinePaymentStatus"] == "disconnected"
        assert body["trial"]["status"] == "active"
        assert body["trial"]["daysGranted"] == 7
        assert body["trial"]["daysRemaining"] == 7
        assert body["trial"]["startedAt"]
        assert body["trial"]["endsAt"]

        db = SessionLocal()
        try:
            with tenant_session_scope(db, tenant_id):
                row = db.execute(
                    text(
                        "SELECT trial_status, trial_started_at, trial_ends_at "
                        "FROM restaurant_trials WHERE restaurante_id = :tenant_id"
                    ),
                    {"tenant_id": tenant_id},
                ).mappings().one()
                assert row["trial_status"] == "active"

                logs = db.query(SuperAdminAuditLog).filter(
                    SuperAdminAuditLog.restaurante_id == tenant_id
                ).all()
                assert len(logs) == 1
                assert logs[0].action == "SUPERADMIN_TENANT_ONBOARD"
                assert logs[0].after_data["trial_days"] == 7
                assert logs[0].after_data["mercado_pago"] == "disconnected"
        finally:
            db.close()
    finally:
        _cleanup_tenant(tenant_id)


def test_superadmin_estende_encerra_e_renova_trial_sem_suspender_tenant():
    tenant_id = None
    try:
        created = client.post(
            "/api/super-admin/restaurantes",
            headers=_superadmin_headers(),
            json=_onboarding_payload(),
        )
        assert created.status_code == 201, created.text
        tenant_id = int(created.json()["id"])

        listing = client.get(
            "/api/super-admin/trials",
            headers=_superadmin_headers(),
        )
        assert listing.status_code == 200, listing.text
        item = next(
            entry for entry in listing.json()
            if entry["restaurantId"] == str(tenant_id)
        )
        assert item["trialStatus"] == "active"
        assert item["daysRemaining"] == 7
        assert item["saasStatus"] == "ACTIVE"

        extended = client.put(
            f"/api/super-admin/trials/restaurantes/{tenant_id}",
            headers=_superadmin_headers(),
            json={
                "action": "extend",
                "days": 3,
                "reason": "Cortesia comercial aprovada pelo Super Admin",
            },
        )
        assert extended.status_code == 200, extended.text
        assert extended.json()["trialStatus"] == "active"
        assert extended.json()["daysRemaining"] >= 9
        assert extended.json()["saasStatus"] == "ACTIVE"

        ended = client.put(
            f"/api/super-admin/trials/restaurantes/{tenant_id}",
            headers=_superadmin_headers(),
            json={
                "action": "end",
                "reason": "Encerramento manual para validar controle administrativo",
            },
        )
        assert ended.status_code == 200, ended.text
        assert ended.json()["trialStatus"] == "ended"
        assert ended.json()["daysRemaining"] == 0
        assert ended.json()["saasStatus"] == "ACTIVE"

        renewed = client.put(
            f"/api/super-admin/trials/restaurantes/{tenant_id}",
            headers=_superadmin_headers(),
            json={
                "action": "renew",
                "days": 2,
                "reason": "Nova janela de avaliação autorizada excepcionalmente",
            },
        )
        assert renewed.status_code == 200, renewed.text
        assert renewed.json()["trialStatus"] == "active"
        assert renewed.json()["daysRemaining"] == 2
        assert renewed.json()["saasStatus"] == "ACTIVE"

        db = SessionLocal()
        try:
            with tenant_session_scope(db, tenant_id):
                actions = [
                    log.action
                    for log in db.query(SuperAdminAuditLog)
                    .filter(SuperAdminAuditLog.restaurante_id == tenant_id)
                    .order_by(SuperAdminAuditLog.id.asc())
                    .all()
                ]
                assert actions == [
                    "SUPERADMIN_TENANT_ONBOARD",
                    "SUPERADMIN_TRIAL_EXTEND",
                    "SUPERADMIN_TRIAL_END",
                    "SUPERADMIN_TRIAL_RENEW",
                ]
        finally:
            db.close()
    finally:
        _cleanup_tenant(tenant_id)


def test_trial_rejeita_acao_sem_motivo_e_nao_mexe_no_saas_status():
    tenant_id = None
    try:
        created = client.post(
            "/api/super-admin/restaurantes",
            headers=_superadmin_headers(),
            json=_onboarding_payload(),
        )
        assert created.status_code == 201, created.text
        tenant_id = int(created.json()["id"])

        invalid = client.put(
            f"/api/super-admin/trials/restaurantes/{tenant_id}",
            headers=_superadmin_headers(),
            json={"action": "extend", "days": 1, "reason": "x"},
        )
        assert invalid.status_code == 422

        db = SessionLocal()
        try:
            with tenant_session_scope(db, tenant_id):
                saas_status = db.execute(
                    text("SELECT saas_status FROM restaurantes WHERE id = :tenant_id"),
                    {"tenant_id": tenant_id},
                ).scalar_one()
                assert saas_status == "active"
        finally:
            db.close()
    finally:
        _cleanup_tenant(tenant_id)
