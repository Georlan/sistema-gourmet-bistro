"""Testes de regressão da reestruturação comercial KÔMA Business V2-A."""
from __future__ import annotations

import uuid
from decimal import Decimal

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import current_restaurante_id, get_db
from app.models import Restaurante, SuperAdminAuditLog
from app.routes import contracts, super_admin_founders
from app.saas_billing_models import SaaSCommercialGrant, SaaSPlanChange, SaaSSubscription
from app.smartpos_models import RestauranteCapability
from app.services.billing_service import effective_catalog_monthly_price, tenant_founders_benefit
from app.services.plan_entitlements import (
    ENTITLEMENT_COURIER_APP,
    has_plan_entitlement,
)
from app.subscription import (
    FOUNDERS_MAX_BENEFICIARIES,
    FOUNDERS_MONTHLY_PRICE,
    subscription_annual_monthly_equivalent,
    subscription_annual_total,
    subscription_monthly_price,
)


@pytest.fixture()
def v2a_env(monkeypatch):
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Restaurante.__table__.create(engine)
    SuperAdminAuditLog.__table__.create(engine)
    SaaSSubscription.__table__.create(engine)
    SaaSPlanChange.__table__.create(engine)
    SaaSCommercialGrant.__table__.create(engine)
    RestauranteCapability.__table__.create(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    monkeypatch.setattr(super_admin_founders, "SessionLocal", Session)
    monkeypatch.setattr(
        super_admin_founders,
        "_discover_restaurant_ids",
        lambda db: [row[0] for row in db.query(Restaurante.id).order_by(Restaurante.id).all()],
    )

    app = FastAPI()
    app.include_router(contracts.router)
    app.include_router(super_admin_founders.router, prefix="/api/super-admin")
    app.dependency_overrides[super_admin_founders.get_current_admin] = lambda: {"user": "superadmin-test"}

    def override_get_db():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db

    with Session() as db:
        # Cria 6 restaurantes com IDs altos para comprovar que Founders não usa ID numérico <= 5.
        for rid, plan in [(101, "pocket"), (102, "pro"), (103, "premium"), (104, "pocket"), (105, "pro"), (106, "pocket")]:
            db.add(Restaurante(id=rid, nome=f"Restaurante {rid}", slug=f"rest-{rid}", plano=plan))
        db.commit()

    yield TestClient(app), Session


def test_v2a_catalog_prices_and_unavailable_modules_blocked(v2a_env):
    client, _ = v2a_env
    assert subscription_monthly_price("pocket") == Decimal("99.90")
    assert subscription_monthly_price("pro") == Decimal("179.90")
    assert subscription_monthly_price("premium") == Decimal("329.90")
    assert subscription_annual_total("pocket") == Decimal("1078.92")
    assert subscription_annual_monthly_equivalent("pocket") == Decimal("89.91")

    catalog_resp = client.get("/api/contracts/catalog")
    assert catalog_resp.status_code == 200
    body = catalog_resp.json()
    assert body["version"] == "2026-11-business-v2a"
    assert body["onlineOrderCommissionEnabled"] is False
    assert body["onboarding"]["standard_price"] == 0.0
    assert body["onboarding"]["vip_price"] == 299.0
    assert body["plans"]["pocket"]["price"] == 99.9

    for mod in ("connect_ifood", "totem", "loyalty", "finance", "fiscal", "whatsapp", "multi", "api", "ai"):
        assert body["futureModules"][mod]["purchasable"] is False
        resp = client.post(f"/api/contracts/modules/{mod}/checkout")
        assert resp.status_code == 409


def test_founders_program_limit_5_audit_isolation_and_price_preservation(v2a_env):
    client, Session = v2a_env

    # Concede aos 5 primeiros beneficiários (IDs 101..105, sem qualquer hardcode de ID <= 5).
    for rid in (101, 102, 103, 104, 105):
        resp = client.post(
            f"/api/super-admin/founders/{rid}",
            json={"reason": f"Founder comercial #{rid}"},
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["fixedMonthlyPrice"] == "79.90"
        assert data["freeAddonLicenses"] is True
        assert data["active"] is True

    # 6º beneficiário deve ser bloqueado pelo limite de 5.
    blocked = client.post(
        "/api/super-admin/founders/106",
        json={"reason": "Tentativa acima do limite"},
    )
    assert blocked.status_code == 409
    assert str(FOUNDERS_MAX_BENEFICIARIES) in blocked.json()["detail"]

    listing = client.get("/api/super-admin/founders").json()
    assert listing["activeCount"] == 5
    assert listing["remainingSlots"] == 0

    # Isolamento entre tenants + preservação do preço R$ 79,90 mesmo em Pro/Premium.
    with Session() as db:
        assert tenant_founders_benefit(db, 101) is not None
        assert tenant_founders_benefit(db, 106) is None
        assert effective_catalog_monthly_price(db, 101, "pocket") == FOUNDERS_MONTHLY_PRICE
        assert effective_catalog_monthly_price(db, 102, "pro") == FOUNDERS_MONTHLY_PRICE
        assert effective_catalog_monthly_price(db, 103, "premium") == FOUNDERS_MONTHLY_PRICE
        assert effective_catalog_monthly_price(db, 106, "pocket") == Decimal("99.90")
        assert effective_catalog_monthly_price(db, 106, "pro") == Decimal("179.90")

        # Auditoria persistida e plano original não mutado.
        audits = db.query(SuperAdminAuditLog).filter(SuperAdminAuditLog.action == "SUPERADMIN_FOUNDERS_GRANT").all()
        assert len(audits) == 5
        assert db.query(Restaurante).filter(Restaurante.id == 101).one().plano == "pocket"

    # Revogar 1 libera exatamente 1 vaga e registra auditoria.
    rev = client.post(
        "/api/super-admin/founders/105/revoke",
        json={"reason": "Transferência de titularidade"},
    )
    assert rev.status_code == 200
    assert rev.json()["active"] is False

    listing_after = client.get("/api/super-admin/founders").json()
    assert listing_after["activeCount"] == 4
    assert listing_after["remainingSlots"] == 1

    granted_106 = client.post(
        "/api/super-admin/founders/106",
        json={"reason": "Preenchendo 5ª vaga após revogação"},
    )
    assert granted_106.status_code == 201


def test_pro_includes_courier_app_entitlement_while_pocket_denies(v2a_env):
    _, Session = v2a_env
    with Session() as db:
        token = current_restaurante_id.set(101)
        try:
            assert has_plan_entitlement(db, 101, ENTITLEMENT_COURIER_APP, stored_plan="pocket") is False
            assert has_plan_entitlement(db, 102, ENTITLEMENT_COURIER_APP, stored_plan="pro") is True
            assert has_plan_entitlement(db, 103, ENTITLEMENT_COURIER_APP, stored_plan="premium") is True
        finally:
            current_restaurante_id.reset(token)
