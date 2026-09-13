from __future__ import annotations

import datetime
import uuid
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import settings
from app.contract_models import ContractAcceptance, RestaurantContractAcceptance
from app.database import get_db
from app.legal_config import LEGAL_SOURCE_BLOB_SHA, LEGAL_SOURCE_COMMIT, LEGAL_VERSION
from app.models import ConfiguracaoRestaurante, Restaurante, SuperAdminAuditLog, Usuario
from app.routes import contracts, saas_billing
from app.routes.super_admin_onboarding import restaurant_trials
from app.saas_billing_models import SaaSBillingSetup, SaaSSubscription
from app.services.billing_service import get_billing_setup, resolve_tenant_entitlement
from app.subscription import subscription_annual_total, subscription_monthly_price

VALID_CPF = "52998224725"
VALID_CNPJ = "11222333000181"


def _documents() -> dict[str, dict]:
    return {
        "terms": {"slug": "termos", "title": "Termos", "version": LEGAL_VERSION, "sections": []},
        "commercial": {"slug": "planos", "title": "Planos", "version": LEGAL_VERSION, "sections": []},
        "dpa": {"slug": "dpa", "title": "DPA", "version": LEGAL_VERSION, "sections": []},
        "privacy": {"slug": "privacidade", "title": "Privacidade", "version": LEGAL_VERSION, "sections": []},
    }


def _contract_payload(plan: str = "pro", billing_cycle: str = "mensal") -> dict[str, Any]:
    return {
        "request_id": str(uuid.uuid4()),
        "contracting_party_name": "Bistrô Recorrente Ltda",
        "contracting_party_tax_id": VALID_CNPJ,
        "restaurant_name": "Bistrô Recorrente",
        "representative_name": "Gestor Recorrente",
        "representative_tax_id": VALID_CPF,
        "representative_role": "Administrador",
        "email": f"recorrente-{uuid.uuid4().hex[:8]}@example.com",
        "phone": "85988887777",
        "plan": plan,
        "billing_cycle": billing_cycle,
        "powers_declared": True,
        "legal_version": LEGAL_VERSION,
        "legal_source_commit": LEGAL_SOURCE_COMMIT,
        "legal_source_blob_sha": LEGAL_SOURCE_BLOB_SHA,
        "documents": _documents(),
    }


@pytest.fixture()
def client_and_session(monkeypatch):
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Restaurante.__table__.create(engine)
    ConfiguracaoRestaurante.__table__.create(engine)
    Usuario.__table__.create(engine)
    SuperAdminAuditLog.__table__.create(engine)
    restaurant_trials.create(engine)
    ContractAcceptance.__table__.create(engine)
    from app.signup_models import SignupBase
    SignupBase.metadata.create_all(engine)
    RestaurantContractAcceptance.__table__.create(engine)
    SaaSBillingSetup.__table__.create(engine)
    SaaSSubscription.__table__.create(engine)

    Session = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    monkeypatch.setattr(contracts, "SessionLocal", Session)
    monkeypatch.setenv("KOMA_LEGAL_PROVIDER_NAME", "Prestador de Teste")
    monkeypatch.setenv("KOMA_LEGAL_PROVIDER_TAX_ID", VALID_CPF)
    monkeypatch.setenv("KOMA_LEGAL_PROVIDER_ADDRESS", "Endereço jurídico de teste, 100")
    monkeypatch.setenv("KOMA_LEGAL_PROVIDER_LOCATION", "Limoeiro do Norte/CE")
    monkeypatch.setattr(settings, "KOMA_SAAS_MANUAL_RELEASE_REQUIRED", False)

    state: dict[str, Any] = {}
    service = saas_billing.default_saas_mp_service
    monkeypatch.setattr(
        service,
        "checkout_capabilities",
        lambda: {
            "credit_card": True,
            "pix_automatic": True,
            "pix": False,
            "publicKey": "TEST-public",
            "environment": "test",
            "isTestMode": True,
            "trialDays": 7,
            "upfrontPaymentAllowed": False,
        },
    )

    def recurring_response(kwargs: dict[str, Any], *, subscription_id: str, payment_method_id: str) -> dict[str, Any]:
        return {
            "id": subscription_id,
            "status": "authorized",
            "payer_id": "payer-test",
            "payment_method_id": payment_method_id,
            "external_reference": kwargs["protocol"],
            "auto_recurring": {
                "frequency": 12 if kwargs["billing_cycle"] == "annual" else 1,
                "frequency_type": "months",
                "transaction_amount": float(kwargs["amount"]),
                "currency_id": "BRL",
                "free_trial": {"frequency": 7, "frequency_type": "days"},
            },
        }

    def create_card(**kwargs):
        response = recurring_response(kwargs, subscription_id=f"sub-card-{uuid.uuid4().hex[:8]}", payment_method_id="visa")
        state[response["id"]] = response
        return response

    def create_pix_auto(**kwargs):
        sub_id = f"sub-pix-auto-{uuid.uuid4().hex[:8]}"
        authorized = recurring_response(kwargs, subscription_id=sub_id, payment_method_id="pix")
        state[sub_id] = authorized
        return {
            **authorized,
            "status": "pending",
            "payment_method_id": None,
            "init_point": f"https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id={sub_id}",
        }

    monkeypatch.setattr(service, "create_preapproval", create_card)
    monkeypatch.setattr(service, "create_pix_automatic_preapproval", create_pix_auto)
    monkeypatch.setattr(service, "get_preapproval", lambda sub_id: state[sub_id])
    monkeypatch.setattr(service, "verify_webhook_signature", lambda **_kwargs: True)
    monkeypatch.setattr(
        service,
        "update_preapproval_next_payment_date",
        lambda preapproval_id, next_payment_date: {
            "id": preapproval_id,
            "next_payment_date": next_payment_date.isoformat(),
            "status": "authorized",
        },
    )

    app = FastAPI()
    app.include_router(contracts.router)
    app.include_router(saas_billing.router)
    app.include_router(saas_billing.webhook_router)

    def override_get_db():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    return TestClient(app), Session


def _accept(client: TestClient, plan: str = "pro", cycle: str = "mensal") -> str:
    response = client.post("/api/contracts/accept", json=_contract_payload(plan, cycle))
    assert response.status_code == 201, response.text
    return str(response.json()["protocol"])


def test_card_authorization_starts_same_seven_day_trial_without_upfront_charge(client_and_session):
    client, Session = client_and_session
    protocol = _accept(client, "pocket", "mensal")

    response = client.post(
        f"/api/contracts/{protocol}/billing/setup",
        json={"payment_method_type": "credit_card", "card_token_id": "tok_test"},
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["status"] == "ready"
    assert data["trialDays"] == 7

    tenant_id = int(data["restaurantId"])
    with Session() as db:
        setup = get_billing_setup(db, protocol)
        assert setup is not None
        assert setup.payment_method_type == "credit_card"
        assert setup.status == "ready"
        sub = db.query(SaaSSubscription).filter(SaaSSubscription.restaurante_id == tenant_id).one()
        assert sub.status == "trialing"
        assert sub.trial_ends_at is not None
        assert sub.current_period_end == sub.trial_ends_at
        entitlement = resolve_tenant_entitlement(db, tenant_id)
        assert entitlement.allowed is True
        assert entitlement.reason == "trial_active"


def test_pix_automatic_is_available_for_monthly_and_returns_authorization_url_with_zero_due_today(client_and_session):
    client, Session = client_and_session
    protocol = _accept(client, "pro", "mensal")

    response = client.post(
        f"/api/contracts/{protocol}/billing/setup",
        json={"payment_method_type": "pix_automatic"},
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["status"] == "authorization_required"
    assert data["paymentMethodType"] == "pix_automatic"
    assert data["amountDueToday"] == 0
    assert data["trialDays"] == 7
    assert data["authorizationUrl"].startswith("https://www.mercadopago.com.br/")

    with Session() as db:
        setup = get_billing_setup(db, protocol)
        assert setup is not None
        assert setup.payment_method_type == "pix_automatic"
        assert setup.status == "pending"
        assert setup.restaurante_id is None
        assert db.query(SaaSSubscription).count() == 0


def test_pix_automatic_annual_keeps_discounted_annual_amount_but_defers_charge_until_after_trial(client_and_session):
    client, _Session = client_and_session
    protocol = _accept(client, "premium", "anual")

    response = client.post(
        f"/api/contracts/{protocol}/billing/setup",
        json={"payment_method_type": "pix_automatic"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["amountDueToday"] == 0
    assert response.json()["trialDays"] == 7
    assert float(subscription_annual_total("premium")) > float(subscription_monthly_price("premium"))


def test_legacy_upfront_pix_is_rejected_even_for_annual_contract(client_and_session):
    client, Session = client_and_session
    protocol = _accept(client, "pro", "anual")

    response = client.post(
        f"/api/contracts/{protocol}/billing/setup",
        json={"payment_method_type": "pix"},
    )
    assert response.status_code == 422
    assert "Pix avulso antecipado foi removido" in response.text

    with Session() as db:
        assert get_billing_setup(db, protocol) is None
        assert db.query(Restaurante).count() == 0


def test_pix_automatic_webhook_only_activates_after_provider_confirms_pix_mandate(client_and_session):
    client, Session = client_and_session
    protocol = _accept(client, "pro", "mensal")
    setup_response = client.post(
        f"/api/contracts/{protocol}/billing/setup",
        json={"payment_method_type": "pix_automatic"},
    )
    subscription_id = setup_response.json()["subscriptionId"]

    webhook = client.post(
        "/api/integrations/saas-billing/mercado-pago/webhook",
        json={"type": "subscription_preapproval", "data": {"id": subscription_id}},
    )
    assert webhook.status_code == 200, webhook.text

    with Session() as db:
        setup = get_billing_setup(db, protocol)
        assert setup is not None
        assert setup.status == "ready"
        assert setup.payment_method_type == "pix_automatic"
        assert setup.restaurante_id is not None
        sub = db.query(SaaSSubscription).filter(SaaSSubscription.restaurante_id == setup.restaurante_id).one()
        assert sub.status == "trialing"
        assert sub.payment_method_type == "pix_automatic"


def test_card_setup_is_idempotent_after_activation(client_and_session):
    client, Session = client_and_session
    protocol = _accept(client, "pro", "mensal")
    first = client.post(
        f"/api/contracts/{protocol}/billing/setup",
        json={"payment_method_type": "credit_card", "card_token_id": "tok_123"},
    )
    second = client.post(
        f"/api/contracts/{protocol}/billing/setup",
        json={"payment_method_type": "credit_card", "card_token_id": "tok_123"},
    )
    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json()["status"] == "already_activated"
    assert second.json()["restaurantId"] == first.json()["restaurantId"]

    with Session() as db:
        assert db.query(Restaurante).count() == 1
        assert db.query(SaaSSubscription).count() == 1


def test_payment_capabilities_do_not_advertise_upfront_pix(client_and_session):
    client, _Session = client_and_session
    response = client.get("/api/contracts/payment-methods")
    assert response.status_code == 200
    data = response.json()
    assert data["credit_card"] is True
    assert data["pix_automatic"] is True
    assert data["pix"] is False
    assert data["trialDays"] == 7
    assert data["upfrontPaymentAllowed"] is False
