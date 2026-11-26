"""Regression tests for KÔMA Business V2-B: company finances, MP ledger & CFO summary."""
from __future__ import annotations

import datetime as dt
import uuid
from decimal import Decimal

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.contract_models import ContractAcceptance, RestaurantContractAcceptance
from app.models import DirectPixFeeInvoice, Restaurante
from app.routes import super_admin_finance
from app.saas_billing_models import (
    SaaSBillingSetup,
    SaaSCommercialGrant,
    SaaSPlanChange,
    SaaSSubscription,
)
from app.services import saas_invoice_reconciliation
from app.super_admin_finance_models import (
    OwnerFinanceAudit,
    OwnerFinanceMonth,
    SaaSCompanyReceipt,
)


@pytest.fixture()
def v2b_env(monkeypatch):
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Restaurante.__table__.create(engine)
    ContractAcceptance.__table__.create(engine)
    RestaurantContractAcceptance.__table__.create(engine)
    SaaSSubscription.__table__.create(engine)
    SaaSPlanChange.__table__.create(engine)
    SaaSCommercialGrant.__table__.create(engine)
    SaaSBillingSetup.__table__.create(engine)
    DirectPixFeeInvoice.__table__.create(engine)
    OwnerFinanceMonth.__table__.create(engine)
    OwnerFinanceAudit.__table__.create(engine)
    SaaSCompanyReceipt.__table__.create(engine)

    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    monkeypatch.setattr(super_admin_finance, "SessionLocal", Session)
    monkeypatch.setattr(
        super_admin_finance,
        "_discover_restaurant_ids",
        lambda db: [row[0] for row in db.query(Restaurante.id).order_by(Restaurante.id).all()],
    )

    app = FastAPI()
    app.include_router(super_admin_finance.router)
    app.dependency_overrides[super_admin_finance.get_current_admin] = lambda: {"user": "cfo-test"}

    return Session, TestClient(app), app


def test_mp_reconciliation_records_idempotent_company_receipt(v2b_env, monkeypatch):
    Session, client, _ = v2b_env
    with Session() as db:
        rest = Restaurante(id=10, nome="Restaurante Teste", plano="pro", billing_mode="subscription", saas_status="active")
        db.add(rest)
        sub = SaaSSubscription(
            restaurante_id=10,
            provider="mercado_pago",
            provider_subscription_id="preapp-10",
            payment_method_type="credit_card",
            billing_cycle="monthly",
            status="active",
        )
        db.add(sub)
        setup = SaaSBillingSetup(
            protocol="KOMA-10",
            restaurante_id=10,
            provider="mercado_pago",
            payment_method_type="credit_card",
            status="ready",
            provider_subscription_id="preapp-10",
            billing_cycle="monthly",
        )
        db.add(setup)
        db.commit()

        class FakeMP:
            def get_authorized_payment(self, invoice_id: str):
                return {
                    "id": invoice_id,
                    "preapproval_id": "preapp-10",
                    "payment": {"id": "mp-pay-001"},
                }

            def get_payment(self, payment_id: str):
                return {
                    "id": payment_id,
                    "status": "approved",
                    "transaction_amount": "179.90",
                    "currency_id": "BRL",
                    "date_approved": "2026-11-10T14:00:00Z",
                    "payment_method_id": "master",
                }

            def get_preapproval(self, preapproval_id: str):
                return {"id": preapproval_id, "external_reference": "KOMA-10"}

        monkeypatch.setattr(saas_invoice_reconciliation, "default_saas_mp_service", FakeMP())
        monkeypatch.setattr(
            saas_invoice_reconciliation,
            "contract_billing_terms",
            lambda _db, _protocol: {"commercial": {"billingAmount": 179.90}},
        )

        # Run reconciliation twice for the same invoice/payment -> must record only 1 receipt
        res1 = saas_invoice_reconciliation.reconcile_invoice(db, "inv-001")
        res2 = saas_invoice_reconciliation.reconcile_invoice(db, "inv-001")
        assert res1["reconciled"] is True
        assert res2["reconciled"] is True

        receipts = db.query(SaaSCompanyReceipt).filter(SaaSCompanyReceipt.restaurante_id == 10).all()
        assert len(receipts) == 1
        assert receipts[0].gross_amount == Decimal("179.90")
        assert receipts[0].source_type == "mp_recurring_payment"
        assert receipts[0].payment_method == "credit_card"
        assert receipts[0].competence_period == "2026-11"


def test_finance_summary_separates_mrr_cash_tenants_and_unknown_costs(v2b_env):
    Session, client, _ = v2b_env
    now = dt.datetime(2026, 11, 15, 12, 0, tzinfo=dt.timezone.utc)
    with Session() as db:
        # Tenant 1: Founder (active, R$ 79.90)
        db.add(Restaurante(id=1, nome="Founder Um", plano="pro", billing_mode="subscription", saas_status="active"))
        db.add(SaaSSubscription(restaurante_id=1, status="active", billing_cycle="monthly"))
        db.add(
            SaaSCommercialGrant(
                restaurante_id=1,
                cohort_code="founders_5",
                fixed_monthly_price=Decimal("79.90"),
                free_addon_licenses=True,
                active=True,
                granted_by="admin",
                reason="Founder 1",
            )
        )
        # Tenant 2: Paying Pro (R$ 179.90) with MP receipt + DirectPix open overdue
        db.add(Restaurante(id=2, nome="Pro Dois", plano="pro", billing_mode="subscription", saas_status="active"))
        db.add(SaaSSubscription(restaurante_id=2, status="active", billing_cycle="monthly"))
        db.add(
            SaaSCompanyReceipt(
                id=str(uuid.uuid4()),
                restaurante_id=2,
                source_type="mp_recurring_payment",
                provider="mercado_pago",
                external_reference="mp-200",
                plan_code="pro",
                payment_method="credit_card",
                status="paid",
                competence_period="2026-11",
                gross_amount=Decimal("179.90"),
                received_at=now,
            )
        )
        db.add(
            DirectPixFeeInvoice(
                restaurante_id=2,
                period="2026-11",
                fees=Decimal("10.00"),
                subscription_amount=Decimal("0.00"),
                status="open",
                due_at=dt.datetime(2026, 11, 5, 12, 0, tzinfo=dt.timezone.utc),
            )
        )
        # Tenant 3: Trialing
        db.add(Restaurante(id=3, nome="Trial Tres", plano="pocket", billing_mode="subscription", saas_status="active"))
        db.add(SaaSSubscription(restaurante_id=3, status="trialing", billing_cycle="monthly"))
        # Tenant 4: Legacy free
        db.add(Restaurante(id=4, nome="Legado Quatro", plano="pocket", billing_mode="legacy", saas_status="active"))
        db.commit()

    resp = client.get("/api/super-admin/finance?period=2026-11")
    assert resp.status_code == 200
    body = resp.json()

    assert body["mrr_contracted"] == "259.80"  # 79.90 + 179.90
    assert body["mrr_by_plan"]["founders"] == "79.90"
    assert body["mrr_by_plan"]["pro"] == "179.90"
    assert body["received"] == "179.90"
    assert body["outstanding"] == "10.00"
    assert body["invoices"]["paid"]["count"] == 1
    assert body["invoices"]["overdue"]["count"] == 1
    assert body["tenant_counts"] == {
        "total": 4,
        "paying": 2,
        "founders": 1,
        "trialing": 1,
        "onboarding": 0,
        "free_or_legacy": 1,
        "suspended": 0,
    }
    assert body["arpa"] == "129.90"
    # Unknown costs must NEVER be treated as zero
    assert body["recorded_result"] is None
    assert body["contribution_margin"] is None
    assert body["break_even_tenants"] is None

    # Supply all monthly costs -> margins and break-even become available
    put_resp = client.put(
        "/api/super-admin/finance/costs/2026-11",
        json={
            "costs": {
                "chatgpt": "100.00",
                "database": "0.00",
                "railway": "30.00",
                "tools": "20.00",
                "taxes": "15.00",
                "other": "5.00",
            },
            "reason": "Faturas conferidas de novembro",
        },
    )
    assert put_resp.status_code == 200

    cfo = client.get("/api/super-admin/finance/cfo-summary?period=2026-11")
    assert cfo.status_code == 200
    cfo_body = cfo.json()
    assert cfo_body["data_completeness"]["complete"] is True
    assert cfo_body["costs"]["fixed_total"] == "150.00"
    assert cfo_body["costs"]["variable_total"] == "20.00"
    assert cfo_body["results"]["contribution_margin"] == "159.90"  # 179.90 - 20.00
    assert cfo_body["results"]["operating_result"] == "9.90"  # 179.90 - 170.00
    assert cfo_body["unit_economics"]["break_even_tenants"] == 2  # ceil(150.00 / 129.90)


def test_cfo_summary_requires_admin(v2b_env):
    _, client, app = v2b_env
    app.dependency_overrides.clear()
    resp = client.get("/api/super-admin/finance/cfo-summary?period=2026-11")
    assert resp.status_code in (401, 403)
