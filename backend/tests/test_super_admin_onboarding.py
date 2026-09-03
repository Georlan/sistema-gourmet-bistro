import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.database import SessionLocal, tenant_session_scope
from app.main import app
from app.models import (
    Categoria,
    ConfiguracaoRestaurante,
    Produto,
    RestaurantPaymentAccount,
    SuperAdminAuditLog,
    Usuario,
)
from app.routes import super_admin, super_admin_onboarding
from app.security import create_access_token, get_password_hash, verify_password


client = TestClient(app)
SUPERADMIN_USERNAME = "owner-onboarding@example.test"
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


def _payload(*, slug: str | None = None) -> dict[str, str]:
    suffix = uuid.uuid4().hex[:10]
    return {
        "name": f"Restaurante Onboarding {suffix}",
        "subdomain": slug or f"onboarding-{suffix}",
        "plan": "pro",
        "admin_name": "Admin Inicial",
        "admin_email": f"admin-{suffix}@example.test",
        "temporary_password": f"Temp-{suffix}-123!",
    }


def _cleanup_tenant(tenant_id: int | None) -> None:
    if not tenant_id:
        return
    db = SessionLocal()
    try:
        with tenant_session_scope(db, tenant_id):
            # SQL direto deixa o FK ON DELETE CASCADE remover a auditoria sem
            # tentar mutar o modelo imutável SuperAdminAuditLog pelo ORM.
            db.execute(
                text("DELETE FROM restaurantes WHERE id = :tenant_id"),
                {"tenant_id": tenant_id},
            )
            db.commit()
    finally:
        db.close()


def _find_restaurant_id_by_slug(slug: str) -> int | None:
    db = SessionLocal()
    try:
        if db.get_bind().dialect.name == "postgresql":
            value = db.execute(
                text("SELECT id FROM koma_internal.resolve_public_restaurant(:identifier)"),
                {"identifier": slug},
            ).scalar_one_or_none()
        else:
            value = db.execute(
                text(
                    "SELECT id FROM restaurantes "
                    "WHERE lower(COALESCE(slug, '')) = lower(:slug) LIMIT 1"
                ),
                {"slug": slug},
            ).scalar_one_or_none()
        return int(value) if value is not None else None
    finally:
        db.close()


def test_onboarding_cria_tenant_defaults_admin_auditoria_e_login():
    payload = _payload()
    tenant_id = None
    try:
        response = client.post(
            "/api/super-admin/restaurantes",
            headers=_superadmin_headers(),
            json=payload,
        )
        assert response.status_code == 201, response.text
        body = response.json()
        tenant_id = int(body["id"])

        assert body["name"] == payload["name"]
        assert body["subdomain"] == payload["subdomain"]
        assert body["plan"] == "pro"
        assert body["status"] == "ACTIVE"
        assert body["onlinePaymentStatus"] == "disconnected"
        assert body["admin"]["email"] == payload["admin_email"]
        assert "temporary_password" not in body
        assert "password" not in body
        assert body["paths"]["cashier"] == "/?view=caixa"
        assert body["paths"]["publicMenu"] == f"/c/{payload['subdomain']}"

        db = SessionLocal()
        try:
            with tenant_session_scope(db, tenant_id):
                restaurant = db.execute(
                    text(
                        "SELECT nome, slug, plano, saas_status "
                        "FROM restaurantes WHERE id = :id"
                    ),
                    {"id": tenant_id},
                ).mappings().one()
                assert restaurant["nome"] == payload["name"]
                assert restaurant["slug"] == payload["subdomain"]
                assert restaurant["plano"] == "pro"
                assert restaurant["saas_status"] == "active"

                config = db.query(ConfiguracaoRestaurante).filter(
                    ConfiguracaoRestaurante.restaurante_id == tenant_id
                ).one()
                assert config.impressao_nome_restaurante == payload["name"]

                admin = db.query(Usuario).filter(
                    Usuario.restaurante_id == tenant_id,
                    Usuario.email == payload["admin_email"],
                ).one()
                assert admin.cargo == "admin"
                assert admin.status == "ativo"
                assert admin.senha_hash
                assert admin.senha_hash != payload["temporary_password"]
                assert verify_password(payload["temporary_password"], admin.senha_hash)

                assert db.query(Categoria).filter(
                    Categoria.restaurante_id == tenant_id
                ).count() == 0
                assert db.query(Produto).filter(
                    Produto.restaurante_id == tenant_id
                ).count() == 0
                assert db.query(RestaurantPaymentAccount).filter(
                    RestaurantPaymentAccount.restaurante_id == tenant_id
                ).count() == 0

                logs = db.query(SuperAdminAuditLog).filter(
                    SuperAdminAuditLog.restaurante_id == tenant_id
                ).all()
                assert len(logs) == 1
                assert logs[0].action == "SUPERADMIN_TENANT_ONBOARD"
                serialized_audit = str(logs[0].after_data).lower()
                assert "password" not in serialized_audit
                assert "senha" not in serialized_audit
                assert payload["temporary_password"].lower() not in serialized_audit
        finally:
            db.close()

        login = client.post(
            "/auth/login",
            json={
                "username": payload["admin_email"],
                "password": payload["temporary_password"],
                "restaurante_id": tenant_id,
            },
        )
        assert login.status_code == 200, login.text
        login_body = login.json()
        assert login_body["usuario"]["restaurante_id"] == tenant_id
        assert login_body["usuario"]["cargo"] == "admin"

        catalog = client.get(
            "/produtos/catalogo",
            headers={"Authorization": f"Bearer {login_body['access_token']}"},
        )
        assert catalog.status_code == 200, catalog.text
        assert catalog.json() == {"categorias": [], "produtos": []}
    finally:
        _cleanup_tenant(tenant_id)


def test_onboarding_slug_duplicado_nao_cria_segundo_tenant():
    payload = _payload()
    first_id = None
    try:
        first = client.post(
            "/api/super-admin/restaurantes",
            headers=_superadmin_headers(),
            json=payload,
        )
        assert first.status_code == 201, first.text
        first_id = int(first.json()["id"])

        duplicate = _payload(slug=payload["subdomain"])
        second = client.post(
            "/api/super-admin/restaurantes",
            headers=_superadmin_headers(),
            json=duplicate,
        )
        assert second.status_code == 409, second.text
        assert "já está em uso" in second.json()["detail"]
        assert _find_restaurant_id_by_slug(payload["subdomain"]) == first_id
    finally:
        _cleanup_tenant(first_id)


def test_onboarding_rejeita_plano_slug_e_senha_invalidos_sem_criar_tenant():
    cases = [
        {"plan": "ultra"},
        {"subdomain": "Slug Inválido"},
        {"temporary_password": "curta"},
        {"temporary_password": "á" * 40},
    ]
    for changes in cases:
        payload = _payload()
        payload.update(changes)
        response = client.post(
            "/api/super-admin/restaurantes",
            headers=_superadmin_headers(),
            json=payload,
        )
        assert response.status_code == 422, response.text
        assert _find_restaurant_id_by_slug(payload["subdomain"]) is None


def test_onboarding_falha_interna_faz_rollback_sem_tenant_parcial(monkeypatch):
    payload = _payload()

    def fail_hash(_: str) -> str:
        raise RuntimeError("hash failure for rollback test")

    monkeypatch.setattr(super_admin_onboarding, "get_password_hash", fail_hash)
    response = client.post(
        "/api/super-admin/restaurantes",
        headers=_superadmin_headers(),
        json=payload,
    )
    assert response.status_code == 500, response.text
    assert _find_restaurant_id_by_slug(payload["subdomain"]) is None
