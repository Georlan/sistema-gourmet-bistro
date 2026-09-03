import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.main import app
from app.models import Restaurante, SuperAdminAuditLog
from app.routes import super_admin
from app.security import create_access_token, get_password_hash
from app.subscription import (
    subscription_mrr_cents,
    subscription_period_amount_cents,
)
from app.subscription_models import RestaurantSubscription


client = TestClient(app)
SUPERADMIN_USERNAME = "billing-owner@example.test"
SUPERADMIN_PASSWORD = "billing-test-password"
TENANT_ID = 301


@pytest.fixture(autouse=True)
def setup_billing_tenant(monkeypatch):
    super_admin.superadmin_login_rate_limiter.history.clear()
    monkeypatch.setenv("SUPERADMIN_USERNAME", SUPERADMIN_USERNAME)
    monkeypatch.setenv(
        "SUPERADMIN_PASSWORD_HASH",
        get_password_hash(SUPERADMIN_PASSWORD),
    )

    db: Session = SessionLocal()
    try:
        db.query(RestaurantSubscription).filter(
            RestaurantSubscription.restaurante_id == TENANT_ID
        ).delete(synchronize_session=False)
        db.query(SuperAdminAuditLog).filter(
            SuperAdminAuditLog.restaurante_id == TENANT_ID
        ).delete(synchronize_session=False)
        tenant = db.query(Restaurante).filter(Restaurante.id == TENANT_ID).one_or_none()
        if tenant is None:
            tenant = Restaurante(
                id=TENANT_ID,
                nome="KOMA Billing QA",
                slug="koma-billing-qa",
                plano="pocket",
                saas_status="active",
            )
            db.add(tenant)
        else:
            tenant.nome = "KOMA Billing QA"
            tenant.slug = "koma-billing-qa"
            tenant.plano = "pocket"
            tenant.saas_status = "active"
        db.commit()
    finally:
        db.close()

    yield

    db = SessionLocal()
    try:
        db.query(RestaurantSubscription).filter(
            RestaurantSubscription.restaurante_id == TENANT_ID
        ).delete(synchronize_session=False)
        db.query(SuperAdminAuditLog).filter(
            SuperAdminAuditLog.restaurante_id == TENANT_ID
        ).delete(synchronize_session=False)
        tenant = db.query(Restaurante).filter(Restaurante.id == TENANT_ID).one_or_none()
        if tenant is not None:
            db.delete(tenant)
        db.commit()
    finally:
        db.close()
    super_admin.superadmin_login_rate_limiter.history.clear()


def _headers() -> dict[str, str]:
    token = create_access_token(
        subject=SUPERADMIN_USERNAME,
        restaurante_id=0,
        role="superadmin",
    )
    return {"Authorization": f"Bearer {token}"}


def _subscription_from_overview(payload: dict) -> dict:
    return next(
        item
        for item in payload["subscriptions"]
        if item["restaurantId"] == str(TENANT_ID)
    )


def test_catalogo_recorrente_oficial_calcula_mensal_e_anual():
    assert subscription_period_amount_cents("pocket", "monthly") == 10_900
    assert subscription_period_amount_cents("pro", "monthly") == 20_900
    assert subscription_period_amount_cents("premium", "monthly") == 30_900

    assert subscription_period_amount_cents("pocket", "annual") == 117_720
    assert subscription_period_amount_cents("pro", "annual") == 225_720
    assert subscription_period_amount_cents("premium", "annual") == 333_720

    assert subscription_mrr_cents("pocket", "annual") == 9_810
    assert subscription_mrr_cents("pro", "annual") == 18_810
    assert subscription_mrr_cents("premium", "annual") == 27_810


def test_restaurante_sem_contrato_nao_vira_mrr_inventado():
    response = client.get("/api/super-admin/billing", headers=_headers())
    assert response.status_code == 200
    payload = response.json()
    item = _subscription_from_overview(payload)

    assert item["subscriptionStatus"] == "not_configured"
    assert item["billingCycle"] is None
    assert item["periodAmountCents"] is None
    assert item["monthlyEquivalentCents"] == 0
    assert payload["summary"]["recurringRevenueReceivedAvailable"] is False


def test_superadmin_configura_contrato_mensal_com_auditoria_atomica():
    response = client.put(
        f"/api/super-admin/billing/restaurantes/{TENANT_ID}",
        headers=_headers(),
        json={
            "plan": "pro",
            "billing_cycle": "monthly",
            "status": "active",
            "reason": "Contrato mensal Pro homologado pelo Super Admin",
        },
    )
    assert response.status_code == 200
    item = response.json()
    assert item["plan"] == "pro"
    assert item["billingCycle"] == "monthly"
    assert item["subscriptionStatus"] == "active"
    assert item["periodAmountCents"] == 20_900
    assert item["monthlyEquivalentCents"] == 20_900

    db: Session = SessionLocal()
    try:
        tenant = db.query(Restaurante).filter(Restaurante.id == TENANT_ID).one()
        contract = db.query(RestaurantSubscription).filter(
            RestaurantSubscription.restaurante_id == TENANT_ID
        ).one()
        audit = db.query(SuperAdminAuditLog).filter(
            SuperAdminAuditLog.restaurante_id == TENANT_ID,
            SuperAdminAuditLog.action == "SUPERADMIN_SUBSCRIPTION_UPDATE",
        ).one()
        assert tenant.plano == "pro"
        assert contract.status == "active"
        assert contract.period_amount_cents == 20_900
        assert audit.after_data["mrr_cents"] == 20_900
    finally:
        db.close()


def test_anual_inadimplente_permanece_contrato_mas_nao_mrr_em_dia():
    period_end = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=30)
    response = client.put(
        f"/api/super-admin/billing/restaurantes/{TENANT_ID}",
        headers=_headers(),
        json={
            "plan": "premium",
            "billing_cycle": "annual",
            "status": "past_due",
            "reason": "Fatura anual em atraso para validar inadimplencia",
            "current_period_end": period_end.isoformat(),
        },
    )
    assert response.status_code == 200
    assert response.json()["periodAmountCents"] == 333_720
    assert response.json()["monthlyEquivalentCents"] == 27_810

    overview = client.get("/api/super-admin/billing", headers=_headers())
    assert overview.status_code == 200
    payload = overview.json()
    item = _subscription_from_overview(payload)
    assert item["subscriptionStatus"] == "past_due"
    assert payload["summary"]["contractedMrrCents"] >= 27_810
    assert payload["summary"]["currentMrrCents"] == 0
    assert payload["summary"]["pastDueSubscriptions"] >= 1
    assert payload["rules"]["pastDueAutoSuspendsTenant"] is False


def test_mudanca_de_plano_fora_do_billing_invalida_mrr_ate_revisao():
    configured = client.put(
        f"/api/super-admin/billing/restaurantes/{TENANT_ID}",
        headers=_headers(),
        json={
            "plan": "pocket",
            "billing_cycle": "monthly",
            "status": "active",
            "reason": "Configuração inicial do contrato Pocket",
        },
    )
    assert configured.status_code == 200

    changed = client.patch(
        f"/api/super-admin/restaurantes/{TENANT_ID}",
        headers=_headers(),
        json={
            "plan": "premium",
            "reason": "Alteração administrativa fora da tela de cobrança",
        },
    )
    assert changed.status_code == 200

    overview = client.get("/api/super-admin/billing", headers=_headers())
    assert overview.status_code == 200
    item = _subscription_from_overview(overview.json())
    assert item["plan"] == "premium"
    assert item["subscriptionStatus"] == "needs_review"
    assert item["catalogMismatch"] is True
    assert item["monthlyEquivalentCents"] == 0
