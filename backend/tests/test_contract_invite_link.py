import datetime
import hashlib
import uuid
import pytest
from fastapi.testclient import TestClient

from app.contract_models import ContractAcceptance, ContractInvite, RestaurantContractAcceptance
from app.database import Base, SessionLocal, engine
from app.legal_config import LEGAL_SOURCE_BLOB_SHA, LEGAL_SOURCE_COMMIT, LEGAL_VERSION
from app.main import app
from app.models import ConfiguracaoRestaurante, Restaurante, SuperAdminAuditLog, Usuario
from app.restaurant_profile_models import RestauranteOperationProfile
from app.saas_billing_models import SaaSSubscription
from app.security import create_access_token
from app.services.restaurant_provisioning import is_provisional_preparation
from app.signup_models import SignupNotification

TEST_TENANT_ID = 9877
VALID_CPF = "52998224725"
VALID_CNPJ = "11222333000181"


def _documents() -> dict[str, dict]:
    return {
        "terms": {"slug": "termos", "version": LEGAL_VERSION, "sections": []},
        "commercial": {"slug": "planos", "version": LEGAL_VERSION, "sections": []},
        "dpa": {"slug": "dpa", "version": LEGAL_VERSION, "sections": []},
        "privacy": {"slug": "privacidade", "version": LEGAL_VERSION, "sections": []},
    }


def _superadmin_headers() -> dict[str, str]:
    token = create_access_token(
        subject="superadmin_test",
        restaurante_id=0,
        role="superadmin",
    )
    return {"Authorization": f"Bearer {token}"}


def _cleanup(db):
    from app.session_models import UserSessionVersion
    db.query(SignupNotification).delete()
    db.query(SuperAdminAuditLog).filter(SuperAdminAuditLog.restaurante_id == TEST_TENANT_ID).delete()
    db.query(ContractInvite).filter(ContractInvite.restaurante_id == TEST_TENANT_ID).delete()
    db.query(RestaurantContractAcceptance).filter(RestaurantContractAcceptance.restaurante_id == TEST_TENANT_ID).delete()
    db.query(ContractAcceptance).filter(ContractAcceptance.email == "convite@jelanches.com.br").delete()
    db.query(SaaSSubscription).filter(SaaSSubscription.restaurante_id == TEST_TENANT_ID).delete()
    db.query(RestauranteOperationProfile).filter(RestauranteOperationProfile.restaurante_id == TEST_TENANT_ID).delete()
    db.query(ConfiguracaoRestaurante).filter(ConfiguracaoRestaurante.restaurante_id == TEST_TENANT_ID).delete()
    db.query(UserSessionVersion).filter(UserSessionVersion.restaurante_id == TEST_TENANT_ID).delete()
    db.query(Usuario).filter(Usuario.restaurante_id == TEST_TENANT_ID).delete()
    db.query(Restaurante).filter(Restaurante.id == TEST_TENANT_ID).delete()
    db.commit()


@pytest.fixture(autouse=True)
def setup_db(monkeypatch):
    monkeypatch.setenv("SUPERADMIN_USERNAME", "superadmin_test")
    monkeypatch.setenv("KOMA_LEGAL_PROVIDER_NAME", "KÔMA Testes")
    monkeypatch.setenv("KOMA_LEGAL_PROVIDER_TAX_ID", VALID_CPF)
    monkeypatch.setenv("KOMA_LEGAL_PROVIDER_ADDRESS", "Rua Teste, 100")
    monkeypatch.setenv("KOMA_LEGAL_PROVIDER_LOCATION", "Fortaleza/CE")

    Base.metadata.create_all(bind=engine)
    ContractAcceptance.__table__.create(bind=engine, checkfirst=True)
    RestaurantContractAcceptance.__table__.create(bind=engine, checkfirst=True)
    ContractInvite.__table__.create(bind=engine, checkfirst=True)
    SaaSSubscription.__table__.create(bind=engine, checkfirst=True)
    SuperAdminAuditLog.__table__.create(bind=engine, checkfirst=True)
    SignupNotification.__table__.create(bind=engine, checkfirst=True)

    with SessionLocal() as db:
        _cleanup(db)
    yield
    with SessionLocal() as db:
        _cleanup(db)


def test_single_use_contract_invite_links_provisional_tenant_and_blocks_reuse():
    client = TestClient(app)
    admin_headers = _superadmin_headers()

    res_provision = client.post(
        "/api/super-admin/restaurantes/provisionar",
        headers=admin_headers,
        json={
            "restaurant_id": TEST_TENANT_ID,
            "name": "JE Lanches Convite",
            "subdomain": "je-lanches-convite-9877",
            "plan": "pocket",
            "operation_profile": "generic",
            "admin_name": "Admin Convite",
            "admin_email": "admin.convite@koma.test",
            "temporary_password": "SenhaForteConvite123!",
            "defer_trial": True,
        },
    )
    assert res_provision.status_code == 201, res_provision.text

    with SessionLocal() as db:
        assert is_provisional_preparation(db, TEST_TENANT_ID) is True

    # Invalid token format fails with 404
    bad_get = client.get("/api/contracts/invite", params={"token": "invalid-token-format-1234"})
    assert bad_get.status_code == 404

    # Super Admin generates single-use invite link
    res_invite = client.post(
        "/api/super-admin/contracts/invite",
        headers=admin_headers,
        json={
            "restaurant_id": TEST_TENANT_ID,
            "billing_cycle": "mensal",
            "expires_hours": 72,
            "reason": "Enviar link direto para aceite contratual pelo WhatsApp.",
        },
    )
    assert res_invite.status_code == 201, res_invite.text
    invite_data = res_invite.json()
    token = invite_data["token"]
    assert invite_data["restaurantId"] == str(TEST_TENANT_ID)
    assert invite_data["plan"] == "pocket"
    assert invite_data["billingCycle"] == "mensal"
    assert f"/aceitar-contrato?token={token}" in invite_data["inviteUrl"]

    # Public preview succeeds
    res_preview = client.get("/api/contracts/invite", params={"token": token})
    assert res_preview.status_code == 200, res_preview.text
    preview = res_preview.json()
    assert preview["restaurantName"] == "JE Lanches Convite"
    assert preview["plan"] == "pocket"
    assert preview["billingCycle"] == "mensal"

    # Public acceptance consumes token and links tenant automatically
    accept_payload = {
        "token": token,
        "request_id": str(uuid.uuid4()),
        "contracting_party_name": "JE Lanches Ltda",
        "contracting_party_tax_id": VALID_CNPJ,
        "restaurant_name": "JE Lanches Convite",
        "representative_name": "José Eduardo",
        "representative_tax_id": VALID_CPF,
        "representative_role": "Proprietário",
        "email": "convite@jelanches.com.br",
        "phone": "81999990000",
        "powers_declared": True,
        "legal_version": LEGAL_VERSION,
        "legal_source_commit": LEGAL_SOURCE_COMMIT,
        "legal_source_blob_sha": LEGAL_SOURCE_BLOB_SHA,
        "documents": _documents(),
    }
    res_accept = client.post(
        "/api/contracts/invite/accept",
        json=accept_payload,
        headers={"cf-connecting-ip": "203.0.113.50", "user-agent": "KomaInviteTest/1.0"},
    )
    assert res_accept.status_code == 201, res_accept.text
    accepted = res_accept.json()
    assert accepted["restaurantId"] == str(TEST_TENANT_ID)
    assert accepted["subscriptionStatus"] == "onboarding"
    assert accepted["protocol"].startswith("KOMA-CTR-")

    with SessionLocal() as db:
        assert is_provisional_preparation(db, TEST_TENANT_ID) is False
        sub = db.query(SaaSSubscription).filter(SaaSSubscription.restaurante_id == TEST_TENANT_ID).one()
        assert sub.status == "onboarding"
        link = db.query(RestaurantContractAcceptance).filter(
            RestaurantContractAcceptance.restaurante_id == TEST_TENANT_ID
        ).one()
        assert link.acceptance_id is not None

    # Reuse of the same single-use token is rejected (409)
    res_preview_reuse = client.get("/api/contracts/invite", params={"token": token})
    assert res_preview_reuse.status_code == 409

    accept_payload["request_id"] = str(uuid.uuid4())
    res_accept_reuse = client.post("/api/contracts/invite/accept", json=accept_payload)
    assert res_accept_reuse.status_code == 409

    # Generating another invite for an already-contracted tenant is rejected (409)
    res_invite_dup = client.post(
        "/api/super-admin/contracts/invite",
        headers=admin_headers,
        json={"restaurant_id": TEST_TENANT_ID, "billing_cycle": "mensal"},
    )
    assert res_invite_dup.status_code == 409


def test_expired_contract_invite_is_rejected():
    client = TestClient(app)
    admin_headers = _superadmin_headers()

    res_provision = client.post(
        "/api/super-admin/restaurantes/provisionar",
        headers=admin_headers,
        json={
            "restaurant_id": TEST_TENANT_ID,
            "name": "JE Lanches Expirado",
            "subdomain": "je-lanches-expirado-9877",
            "plan": "pocket",
            "operation_profile": "generic",
            "admin_name": "Admin Expirado",
            "admin_email": "admin.expirado@koma.test",
            "temporary_password": "SenhaForteConvite123!",
            "defer_trial": True,
        },
    )
    assert res_provision.status_code == 201

    res_invite = client.post(
        "/api/super-admin/contracts/invite",
        headers=admin_headers,
        json={"restaurant_id": TEST_TENANT_ID, "billing_cycle": "mensal", "expires_hours": 1},
    )
    assert res_invite.status_code == 201
    token = res_invite.json()["token"]
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()

    with SessionLocal() as db:
        invite = db.query(ContractInvite).filter(ContractInvite.token_hash == token_hash).one()
        invite.expires_at = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=5)
        db.commit()

    res_preview = client.get("/api/contracts/invite", params={"token": token})
    assert res_preview.status_code == 410
