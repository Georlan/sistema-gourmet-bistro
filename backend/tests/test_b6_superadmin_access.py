import datetime
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.database import SessionLocal, tenant_session_scope
from app.main import app
from app.models import SuperAdminAuditLog, Usuario
from app.routes import super_admin
from app.security import create_access_token, get_password_hash


client = TestClient(app)
SUPERADMIN_USERNAME = "owner-b6-access@example.test"
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


def _tenant_headers(user_id: str, tenant_id: int, *, role: str = "admin") -> dict[str, str]:
    token = create_access_token(
        subject=user_id,
        restaurante_id=tenant_id,
        role=role,
    )
    return {"Authorization": f"Bearer {token}"}


def _cleanup_tenant(tenant_id: int | None) -> None:
    if not tenant_id:
        return
    db = SessionLocal()
    try:
        with tenant_session_scope(db, tenant_id):
            for table_name in (
                "restaurant_trials",
                "super_admin_audit_logs",
                "restaurant_payment_accounts",
                "user_session_versions",
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


def _create_tenant() -> tuple[int, str]:
    suffix = uuid.uuid4().hex[:10]
    res = client.post(
        "/api/super-admin/restaurantes",
        headers=_superadmin_headers(),
        json={
            "name": f"B6 Access {suffix}",
            "subdomain": f"b6-access-{suffix}",
            "plan": "pro",
            "admin_name": "Admin B6",
            "admin_email": f"b6-{suffix}@example.test",
            "temporary_password": f"Temp-{suffix}-123!",
        },
    )
    assert res.status_code == 201, res.text
    tenant_id = int(res.json()["id"])
    db = SessionLocal()
    try:
        with tenant_session_scope(db, tenant_id):
            user_id = (
                db.query(Usuario.id)
                .filter(Usuario.restaurante_id == tenant_id, Usuario.cargo == "admin")
                .scalar()
            )
            assert user_id
            return tenant_id, str(user_id)
    finally:
        db.close()


def test_superadmin_role_demotion_revokes_active_jwt_sessions():
    tenant_id = None
    try:
        tenant_id, admin1_id = _create_tenant()
        admin2_id = str(uuid.uuid4())
        db = SessionLocal()
        try:
            with tenant_session_scope(db, tenant_id):
                db.add(
                    Usuario(
                        id=admin2_id,
                        restaurante_id=tenant_id,
                        nome="Segundo Admin",
                        email=f"admin2-{uuid.uuid4().hex[:8]}@example.test",
                        cargo="admin",
                        status="ativo",
                        senha_hash=get_password_hash("SenhaSegura123!"),
                    )
                )
                db.commit()
        finally:
            db.close()

        old_admin_headers = _tenant_headers(admin2_id, tenant_id, role="admin")
        assert client.get("/auth/usuarios", headers=old_admin_headers).status_code == 200

        # Super Admin rebaixa o segundo admin para garçom sem alterar status para inativo
        demote = client.put(
            f"/api/super-admin/access/restaurantes/{tenant_id}/usuarios/{admin2_id}",
            headers=_superadmin_headers(),
            json={
                "role": "garcom",
                "reason": "Rebaixamento administrativo de cargo após revisão de acessos",
            },
        )
        assert demote.status_code == 200, demote.text
        assert demote.json()["sessionsRevoked"] is True
        assert demote.json()["user"]["role"] == "garcom"

        # O JWT antigo com role=admin DEVE ser rejeitado imediatamente com 401
        stale = client.get("/auth/usuarios", headers=old_admin_headers)
        assert stale.status_code == 401, stale.text

        db = SessionLocal()
        try:
            with tenant_session_scope(db, tenant_id):
                audit = (
                    db.query(SuperAdminAuditLog)
                    .filter(
                        SuperAdminAuditLog.restaurante_id == tenant_id,
                        SuperAdminAuditLog.action == "SUPERADMIN_USER_ACCESS_UPDATE",
                    )
                    .order_by(SuperAdminAuditLog.created_at.desc())
                    .first()
                )
                assert audit is not None
                assert audit.after_data["sessions_revoked"] is True
        finally:
            db.close()
    finally:
        _cleanup_tenant(tenant_id)


def test_soft_deleted_admin_does_not_bypass_last_admin_guard_or_appear_in_access_center():
    tenant_id = None
    try:
        tenant_id, active_admin_id = _create_tenant()
        removed_admin_id = str(uuid.uuid4())
        db = SessionLocal()
        try:
            with tenant_session_scope(db, tenant_id):
                db.add(
                    Usuario(
                        id=removed_admin_id,
                        restaurante_id=tenant_id,
                        nome="Admin Removido",
                        email=f"removed-{uuid.uuid4().hex[:8]}@example.test",
                        cargo="admin",
                        status="ativo",
                        removed_at=datetime.datetime.now(datetime.timezone.utc),
                        senha_hash=get_password_hash("SenhaSegura123!"),
                    )
                )
                db.commit()
        finally:
            db.close()

        # 1. Central de acessos deve contar apenas 1 admin ativo e não listar o removido
        detail = client.get(
            f"/api/super-admin/access/restaurantes/{tenant_id}",
            headers=_superadmin_headers(),
        )
        assert detail.status_code == 200, detail.text
        body = detail.json()
        assert body["activeAdmins"] == 1
        assert all(user["id"] != removed_admin_id for user in body["users"])

        # 2. Tentar rebaixar o ÚNICO admin realmente ativo sem force=true DEVE ser bloqueado (409)
        guarded = client.put(
            f"/api/super-admin/access/restaurantes/{tenant_id}/usuarios/{active_admin_id}",
            headers=_superadmin_headers(),
            json={
                "role": "garcom",
                "reason": "Tentativa sem force que não pode contar admin removido",
            },
        )
        assert guarded.status_code == 409, guarded.text
        assert "force=true" in guarded.json()["detail"]

        # 3. Tentar alterar usuário removido deve retornar 404
        removed_mut = client.put(
            f"/api/super-admin/access/restaurantes/{tenant_id}/usuarios/{removed_admin_id}",
            headers=_superadmin_headers(),
            json={
                "status": "inativo",
                "reason": "Tentativa de alterar usuário já removido",
            },
        )
        assert removed_mut.status_code == 404, removed_mut.text
    finally:
        _cleanup_tenant(tenant_id)
