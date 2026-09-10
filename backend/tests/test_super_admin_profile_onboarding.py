import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.database import SessionLocal, tenant_session_scope
from app.main import app
from app.models import Categoria, Produto, RestaurantPaymentAccount, SuperAdminAuditLog
from app.restaurant_profile_models import RestauranteOperationProfile
from app.routes import super_admin
from app.security import create_access_token, get_password_hash


client = TestClient(app)
SUPERADMIN_USERNAME = "owner-profile-onboarding@example.test"
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


def _payload(profile: str | None = "pizzaria") -> dict[str, str]:
    suffix = uuid.uuid4().hex[:10]
    payload = {
        "name": f"Restaurante Perfil {suffix}",
        "subdomain": f"perfil-{suffix}",
        "plan": "pro",
        "admin_name": "Admin Perfil",
        "admin_email": f"profile-{suffix}@example.test",
        "temporary_password": f"Temp-{suffix}-123!",
    }
    if profile is not None:
        payload["operation_profile"] = profile
    return payload


def _cleanup_tenant(tenant_id: int | None) -> None:
    if not tenant_id:
        return
    db = SessionLocal()
    try:
        with tenant_session_scope(db, tenant_id):
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
    finally:
        db.close()


def test_profiled_onboarding_persists_profile_without_catalog_side_effects():
    payload = _payload("pizzaria")
    tenant_id = None
    try:
        response = client.post(
            "/api/super-admin/restaurantes/provisionar",
            headers=_superadmin_headers(),
            json=payload,
        )
        assert response.status_code == 201, response.text
        body = response.json()
        tenant_id = int(body["id"])

        assert body["operationProfile"] == "pizzaria"
        assert body["onlinePaymentStatus"] == "disconnected"

        db = SessionLocal()
        try:
            with tenant_session_scope(db, tenant_id):
                profile = db.query(RestauranteOperationProfile).filter(
                    RestauranteOperationProfile.restaurante_id == tenant_id
                ).one()
                assert profile.profile_key == "pizzaria"

                assert db.query(Categoria).filter(
                    Categoria.restaurante_id == tenant_id
                ).count() == 0
                assert db.query(Produto).filter(
                    Produto.restaurante_id == tenant_id
                ).count() == 0
                assert db.query(RestaurantPaymentAccount).filter(
                    RestaurantPaymentAccount.restaurante_id == tenant_id
                ).count() == 0

                audit = db.query(SuperAdminAuditLog).filter(
                    SuperAdminAuditLog.restaurante_id == tenant_id,
                    SuperAdminAuditLog.action == "SUPERADMIN_TENANT_ONBOARD",
                ).one()
                assert audit.after_data["operation_profile"] == "pizzaria"
        finally:
            db.close()
    finally:
        _cleanup_tenant(tenant_id)


def test_profiled_onboarding_defaults_to_generic_when_profile_is_absent():
    payload = _payload(None)
    tenant_id = None
    try:
        response = client.post(
            "/api/super-admin/restaurantes/provisionar",
            headers=_superadmin_headers(),
            json=payload,
        )
        assert response.status_code == 201, response.text
        body = response.json()
        tenant_id = int(body["id"])
        assert body["operationProfile"] == "generic"
    finally:
        _cleanup_tenant(tenant_id)


@pytest.mark.parametrize(
    "invalid_profile",
    ["Pizzaria com espaço", "../pizzaria", "pizzaria!", "áçai"],
)
def test_profiled_onboarding_rejects_invalid_profile_keys(invalid_profile: str):
    payload = _payload(invalid_profile)
    response = client.post(
        "/api/super-admin/restaurantes/provisionar",
        headers=_superadmin_headers(),
        json=payload,
    )
    assert response.status_code == 422, response.text
