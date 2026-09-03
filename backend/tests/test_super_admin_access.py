import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.database import SessionLocal, tenant_session_scope
from app.main import app
from app.models import SuperAdminAuditLog, Usuario
from app.routes import super_admin
from app.security import create_access_token, get_password_hash, get_user_token_version


client = TestClient(app)
SUPERADMIN_USERNAME = "owner-access@example.test"
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


def _tenant_headers(
    user_id: str,
    tenant_id: int,
    *,
    token_version: int | None = None,
) -> dict[str, str]:
    token = create_access_token(
        subject=user_id,
        restaurante_id=tenant_id,
        role="admin",
        token_version=token_version,
    )
    return {"Authorization": f"Bearer {token}"}


def _fresh_tenant_headers(user_id: str, tenant_id: int) -> dict[str, str]:
    db = SessionLocal()
    try:
        with tenant_session_scope(db, tenant_id):
            token_version = get_user_token_version(
                db,
                user_id=user_id,
                restaurante_id=tenant_id,
            )
    finally:
        db.close()
    return _tenant_headers(user_id, tenant_id, token_version=token_version)


def _onboarding_payload() -> dict[str, str]:
    suffix = uuid.uuid4().hex[:10]
    return {
        "name": f"Access Restaurante {suffix}",
        "subdomain": f"access-{suffix}",
        "plan": "pro",
        "admin_name": "Admin Access",
        "admin_email": f"access-{suffix}@example.test",
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
    response = client.post(
        "/api/super-admin/restaurantes",
        headers=_superadmin_headers(),
        json=_onboarding_payload(),
    )
    assert response.status_code == 201, response.text
    tenant_id = int(response.json()["id"])

    db = SessionLocal()
    try:
        with tenant_session_scope(db, tenant_id):
            user_id = (
                db.query(Usuario.id)
                .filter(
                    Usuario.restaurante_id == tenant_id,
                    Usuario.cargo == "admin",
                )
                .scalar()
            )
            assert user_id
            return tenant_id, str(user_id)
    finally:
        db.close()


def test_access_center_lista_diagnostico_real_sem_expor_segredos():
    tenant_id = None
    try:
        tenant_id, user_id = _create_tenant()

        listing = client.get(
            "/api/super-admin/access",
            headers=_superadmin_headers(),
        )
        assert listing.status_code == 200, listing.text
        item = next(
            entry for entry in listing.json()
            if entry["restaurantId"] == str(tenant_id)
        )
        assert item["activeUsers"] == 1
        assert item["activeAdmins"] == 1
        assert item["inactiveUsers"] == 0
        assert item["onlinePaymentStatus"] == "disconnected"
        assert any(
            diagnostic["code"] == "ONLINE_PAYMENT_DISCONNECTED"
            for diagnostic in item["diagnostics"]
        )

        detail = client.get(
            f"/api/super-admin/access/restaurantes/{tenant_id}",
            headers=_superadmin_headers(),
        )
        assert detail.status_code == 200, detail.text
        body = detail.json()
        assert body["users"][0]["id"] == user_id
        serialized = detail.text.lower()
        assert "senha_hash" not in serialized
        assert "token_convite" not in serialized
        assert "access_token" not in serialized
        assert "refresh_token" not in serialized
        assert "token_version" not in serialized
    finally:
        _cleanup_tenant(tenant_id)


def test_superadmin_pode_forcar_bloqueio_do_ultimo_admin_sem_ressuscitar_token_antigo():
    tenant_id = None
    try:
        tenant_id, user_id = _create_tenant()
        legacy_headers = _tenant_headers(user_id, tenant_id)

        before = client.get("/auth/usuarios", headers=legacy_headers)
        assert before.status_code == 200, before.text

        guarded = client.put(
            f"/api/super-admin/access/restaurantes/{tenant_id}/usuarios/{user_id}",
            headers=_superadmin_headers(),
            json={
                "status": "inativo",
                "reason": "Teste do guard de último administrador",
            },
        )
        assert guarded.status_code == 409, guarded.text
        assert "force=true" in guarded.json()["detail"]

        forced = client.put(
            f"/api/super-admin/access/restaurantes/{tenant_id}/usuarios/{user_id}",
            headers=_superadmin_headers(),
            json={
                "status": "inativo",
                "force": True,
                "reason": "Bloqueio operacional intencional autorizado pelo Super Admin",
            },
        )
        assert forced.status_code == 200, forced.text
        assert forced.json()["forced"] is True
        assert forced.json()["sessionsRevoked"] is True
        assert forced.json()["user"]["status"] == "inativo"
        assert forced.json()["tenant"]["activeAdmins"] == 0
        assert any(
            diagnostic["code"] == "NO_ACTIVE_ADMIN"
            for diagnostic in forced.json()["tenant"]["diagnostics"]
        )

        blocked = client.get("/auth/usuarios", headers=legacy_headers)
        assert blocked.status_code == 401, blocked.text

        db = SessionLocal()
        try:
            with tenant_session_scope(db, tenant_id):
                audit = (
                    db.query(SuperAdminAuditLog)
                    .filter(
                        SuperAdminAuditLog.restaurante_id == tenant_id,
                        SuperAdminAuditLog.action == "SUPERADMIN_USER_ACCESS_FORCE_UPDATE",
                    )
                    .one()
                )
                assert audit.reason == "Bloqueio operacional intencional autorizado pelo Super Admin"
                assert audit.before_data == {
                    "user_id": user_id,
                    "status": "ativo",
                    "role": "admin",
                }
                assert audit.after_data["status"] == "inativo"
                assert audit.after_data["forced"] is True
                assert audit.after_data["sessions_revoked"] is True
                assert "token" not in str(audit.after_data).lower()
        finally:
            db.close()

        reactivated = client.put(
            f"/api/super-admin/access/restaurantes/{tenant_id}/usuarios/{user_id}",
            headers=_superadmin_headers(),
            json={
                "status": "ativo",
                "reason": "Reativação após validação do controle administrativo",
            },
        )
        assert reactivated.status_code == 200, reactivated.text
        assert reactivated.json()["forced"] is False
        assert reactivated.json()["sessionsRevoked"] is False
        assert reactivated.json()["user"]["status"] == "ativo"

        # Reativar a identidade nunca ressuscita um JWT emitido antes do bloqueio.
        still_revoked = client.get("/auth/usuarios", headers=legacy_headers)
        assert still_revoked.status_code == 401, still_revoked.text

        fresh_headers = _fresh_tenant_headers(user_id, tenant_id)
        restored = client.get("/auth/usuarios", headers=fresh_headers)
        assert restored.status_code == 200, restored.text
    finally:
        _cleanup_tenant(tenant_id)


def test_superadmin_revoga_sessoes_sem_alterar_status_cargo_ou_credencial():
    tenant_id = None
    try:
        tenant_id, user_id = _create_tenant()
        old_headers = _tenant_headers(user_id, tenant_id)

        assert client.get("/auth/usuarios", headers=old_headers).status_code == 200

        revoked = client.post(
            f"/api/super-admin/access/restaurantes/{tenant_id}/usuarios/{user_id}/revogar-sessoes",
            headers=_superadmin_headers(),
            json={"reason": "Encerramento preventivo das sessões do administrador"},
        )
        assert revoked.status_code == 200, revoked.text
        assert revoked.json()["message"] == "Sessões do usuário encerradas com sucesso."
        assert revoked.json()["user"]["status"] == "ativo"
        assert revoked.json()["user"]["role"] == "admin"
        assert "token" not in revoked.text.lower()
        assert "senha" not in revoked.text.lower()

        assert client.get("/auth/usuarios", headers=old_headers).status_code == 401

        detail = client.get(
            f"/api/super-admin/access/restaurantes/{tenant_id}",
            headers=_superadmin_headers(),
        )
        assert detail.status_code == 200, detail.text
        user_payload = next(user for user in detail.json()["users"] if user["id"] == user_id)
        assert user_payload["status"] == "ativo"
        assert user_payload["role"] == "admin"

        fresh_headers = _fresh_tenant_headers(user_id, tenant_id)
        assert client.get("/auth/usuarios", headers=fresh_headers).status_code == 200

        db = SessionLocal()
        try:
            with tenant_session_scope(db, tenant_id):
                audit = (
                    db.query(SuperAdminAuditLog)
                    .filter(
                        SuperAdminAuditLog.restaurante_id == tenant_id,
                        SuperAdminAuditLog.action == "SUPERADMIN_USER_SESSIONS_REVOKED",
                    )
                    .one()
                )
                assert audit.reason == "Encerramento preventivo das sessões do administrador"
                assert audit.before_data == {
                    "user_id": user_id,
                    "status": "ativo",
                    "role": "admin",
                }
                assert audit.after_data == {
                    "user_id": user_id,
                    "status": "ativo",
                    "role": "admin",
                    "sessions_revoked": True,
                }
                serialized = f"{audit.before_data} {audit.after_data}".lower()
                assert "token" not in serialized
                assert "senha" not in serialized
        finally:
            db.close()
    finally:
        _cleanup_tenant(tenant_id)


def test_superadmin_nao_revoga_sessao_de_convite_pendente():
    tenant_id = None
    try:
        tenant_id, _ = _create_tenant()
        pending_user_id = str(uuid.uuid4())
        db = SessionLocal()
        try:
            with tenant_session_scope(db, tenant_id):
                db.add(
                    Usuario(
                        id=pending_user_id,
                        restaurante_id=tenant_id,
                        nome="Convite Pendente",
                        email=f"pending-{uuid.uuid4().hex[:8]}@example.test",
                        cargo="garcom",
                        status="pendente_ativacao",
                    )
                )
                db.commit()
        finally:
            db.close()

        response = client.post(
            f"/api/super-admin/access/restaurantes/{tenant_id}/usuarios/{pending_user_id}/revogar-sessoes",
            headers=_superadmin_headers(),
            json={"reason": "Teste de convite ainda sem sessão operacional"},
        )
        assert response.status_code == 409, response.text
        assert "sessão operacional" in response.json()["detail"]
    finally:
        _cleanup_tenant(tenant_id)


def test_superadmin_nao_ativa_convite_pendente_sem_fluxo_de_credencial():
    tenant_id = None
    try:
        tenant_id, _ = _create_tenant()
        pending_user_id = str(uuid.uuid4())
        db = SessionLocal()
        try:
            with tenant_session_scope(db, tenant_id):
                db.add(
                    Usuario(
                        id=pending_user_id,
                        restaurante_id=tenant_id,
                        nome="Convite Pendente",
                        email=f"pending-{uuid.uuid4().hex[:8]}@example.test",
                        cargo="garcom",
                        status="pendente_ativacao",
                    )
                )
                db.commit()
        finally:
            db.close()

        response = client.put(
            f"/api/super-admin/access/restaurantes/{tenant_id}/usuarios/{pending_user_id}",
            headers=_superadmin_headers(),
            json={
                "status": "ativo",
                "force": True,
                "reason": "Tentativa de override que não pode criar credencial inexistente",
            },
        )
        assert response.status_code == 409, response.text
        assert "credencial" in response.json()["detail"].lower()
    finally:
        _cleanup_tenant(tenant_id)
