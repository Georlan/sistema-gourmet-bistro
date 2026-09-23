from __future__ import annotations

import datetime
import json
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
from app.crypt import decrypt_field, encrypt_field
from app.database import get_db
from app.legal_config import LEGAL_SOURCE_BLOB_SHA, LEGAL_SOURCE_COMMIT, LEGAL_VERSION
from app.models import ConfiguracaoRestaurante, Restaurante, SuperAdminAuditLog, Usuario
from app.routes import contracts, saas_billing, saas_pix
from app.routes.super_admin_onboarding import restaurant_trials
from app.saas_billing_models import SaaSBillingSetup, SaaSSubscription
from app.services.billing_service import (
    get_billing_setup,
    resolve_tenant_entitlement,
    upsert_billing_setup,
)
from app.services.saas_mercadopago import SaasMercadoPagoError
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
            "account_money": True,
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

    def create_account_money(**kwargs):
        sub_id = f"sub-acc-money-{uuid.uuid4().hex[:8]}"
        authorized = recurring_response(kwargs, subscription_id=sub_id, payment_method_id="account_money")
        state[sub_id] = authorized
        return {
            **authorized,
            "status": "pending",
            "payment_method_id": None,
            "init_point": f"https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id={sub_id}",
        }

    monkeypatch.setattr(service, "create_preapproval", create_card)
    monkeypatch.setattr(service, "create_pix_automatic_preapproval", create_pix_auto)
    monkeypatch.setattr(service, "create_account_money_preapproval", create_account_money)
    def get_preapproval_mock(sub_id: str):
        if sub_id in state:
            return state[sub_id]
        raise SaasMercadoPagoError("Assinatura não encontrada", status_code=404)

    monkeypatch.setattr(service, "get_preapproval", get_preapproval_mock)
    monkeypatch.setattr(
        service,
        "get_authorized_payment",
        lambda inv_id: (_ for _ in ()).throw(SaasMercadoPagoError("Fatura não encontrada", status_code=404)),
    )
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
    app.include_router(saas_pix.contract_router)

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


def _legacy_free_pocket(client: TestClient, Session) -> str:
    """Simula um aceite Pocket R$ 0 já gravado antes do novo catálogo."""
    protocol = _accept(client, "pocket", "mensal")
    with Session() as db:
        acceptance = db.query(ContractAcceptance).filter_by(protocol=protocol).one()
        receipt = json.loads(decrypt_field(acceptance.receipt_snapshot_encrypted))
        receipt["commercial"].update({
            "pricingVersion": "2026-09-vnext",
            "fixedMonthlyPrice": "0.00",
            "billingAmount": "0.00",
            "fixedBillingRequired": False,
            "trialDays": 0,
            "trialWaivesFixedFeeOnly": False,
        })
        receipt["documents"]["version"] = "2.6"
        acceptance.fixed_monthly_price = 0
        acceptance.billing_amount = 0
        acceptance.legal_version = "2.6"
        acceptance.receipt_snapshot_encrypted = encrypt_field(json.dumps(receipt, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
        db.commit()
    return protocol


def test_pocket_zero_activates_without_provider_recurrence(client_and_session, monkeypatch):
    client, Session = client_and_session
    protocol = _legacy_free_pocket(client, Session)

    service = saas_billing.default_saas_mp_service

    def _provider_must_not_run(**_kwargs):
        raise AssertionError("Pocket R$0 não pode criar recorrência no Mercado Pago")

    monkeypatch.setattr(service, "create_preapproval", _provider_must_not_run)
    monkeypatch.setattr(service, "create_account_money_preapproval", _provider_must_not_run)

    response = client.post(f"/api/contracts/{protocol}/billing/activate-free")
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["status"] == "ready"
    assert data["amountDueToday"] == 0
    assert data["trialDays"] == 0
    assert data["fixedBillingRequired"] is False

    tenant_id = int(data["restaurantId"])
    with Session() as db:
        assert get_billing_setup(db, protocol) is None
        sub = (
            db.query(SaaSSubscription)
            .filter(SaaSSubscription.restaurante_id == tenant_id)
            .one()
        )
        assert sub.status == "active"
        assert sub.provider_subscription_id is None
        assert sub.payment_method_type is None
        assert sub.trial_started_at is None
        assert sub.trial_ends_at is None
        entitlement = resolve_tenant_entitlement(db, tenant_id)
        assert entitlement.allowed is True
        assert entitlement.billing_status == "active"


def test_pocket_zero_rejects_any_preexisting_billing_setup(client_and_session):
    client, Session = client_and_session
    protocol = _legacy_free_pocket(client, Session)

    with Session() as db:
        upsert_billing_setup(
            db,
            protocol=protocol,
            payment_method_type="credit_card",
            status="failed",
            billing_cycle="monthly",
        )
        db.commit()

    response = client.post(f"/api/contracts/{protocol}/billing/activate-free")
    assert response.status_code == 409
    assert "encerrada explicitamente" in response.text

    with Session() as db:
        setup = get_billing_setup(db, protocol)
        assert setup is not None
        assert setup.status == "failed"
        assert db.query(Restaurante).count() == 0
        assert db.query(SaaSSubscription).count() == 0


def test_pocket_zero_rejects_paid_billing_setup_before_provider_call(client_and_session, monkeypatch):
    client, Session = client_and_session
    protocol = _legacy_free_pocket(client, Session)
    provider_called = False

    def _unexpected_provider(**_kwargs):
        nonlocal provider_called
        provider_called = True
        raise AssertionError("provider should not be called")

    monkeypatch.setattr(
        saas_billing.default_saas_mp_service,
        "create_preapproval",
        _unexpected_provider,
    )
    response = client.post(
        f"/api/contracts/{protocol}/billing/setup",
        json={"payment_method_type": "credit_card", "card_token_id": "tok_test"},
    )
    assert response.status_code == 409
    assert "não possui mensalidade fixa" in response.text
    assert provider_called is False
    with Session() as db:
        assert get_billing_setup(db, protocol) is None
        assert db.query(SaaSSubscription).count() == 0


@pytest.mark.parametrize(
    ("plan", "cycle", "method", "expected_amount", "expected_frequency"),
    [
        ("pocket", "mensal", "credit_card", 39.0, 1),
        ("pocket", "mensal", "account_money", 39.0, 1),
        ("pro", "mensal", "credit_card", 129.0, 1),
        ("pro", "mensal", "account_money", 129.0, 1),
        ("pro", "anual", "credit_card", 1393.20, 12),
        ("pro", "anual", "account_money", 1393.20, 12),
        ("premium", "mensal", "credit_card", 249.0, 1),
        ("premium", "mensal", "account_money", 249.0, 1),
        ("premium", "anual", "credit_card", 2689.20, 12),
        ("premium", "anual", "account_money", 2689.20, 12),
    ],
)
def test_paid_plan_billing_uses_signed_amount_and_cycle(
    client_and_session, plan, cycle, method, expected_amount, expected_frequency
):
    client, Session = client_and_session
    service = saas_billing.default_saas_mp_service
    protocol = _accept(client, plan, cycle)
    with Session() as db:
        acceptance = db.query(ContractAcceptance).filter_by(protocol=protocol).one()
        receipt = json.loads(decrypt_field(acceptance.receipt_snapshot_encrypted))
        assert float(receipt["commercial"]["billingAmount"]) == expected_amount
        assert receipt["commercial"]["billingCycle"] == cycle
    response = client.post(f"/api/contracts/{protocol}/billing/setup", json={
        "payment_method_type": method,
        **({"card_token_id": f"tok_{plan}_{cycle}"} if method == "credit_card" else {}),
    })
    assert response.status_code == 200, response.text
    assert response.json()["trialDays"] == 7
    if method == "account_money":
        assert response.json()["amountDueToday"] == 0
    with Session() as db:
        setup = get_billing_setup(db, protocol)
        assert setup is not None and setup.provider_subscription_id
        mandate = service.get_preapproval(setup.provider_subscription_id)
    recurring = mandate["auto_recurring"]
    assert recurring["transaction_amount"] == expected_amount
    assert recurring["frequency"] == expected_frequency
    assert recurring["frequency_type"] == "months"
    assert recurring["currency_id"] == "BRL"
    assert recurring["free_trial"] == {"frequency": 7, "frequency_type": "days"}


@pytest.mark.parametrize(
    ("plan", "cycle", "expected_amount", "expected_cycle"),
    [
        ("pocket", "mensal", 39.0, "monthly"),
        ("pro", "mensal", 129.0, "monthly"),
        ("pro", "anual", 1393.20, "annual"),
        ("premium", "mensal", 249.0, "monthly"),
        ("premium", "anual", 2689.20, "annual"),
    ],
)
def test_pix_selection_preserves_signed_amount_without_creating_payment(
    client_and_session, monkeypatch, plan, cycle, expected_amount, expected_cycle
):
    client, Session = client_and_session
    monkeypatch.setattr(saas_pix, "_pix_available", lambda: (True, {}))
    protocol = _accept(client, plan, cycle)
    response = client.post(f"/api/contracts/{protocol}/billing/pix/select")
    assert response.status_code == 200, response.text
    assert response.json()["trialDays"] == 7
    with Session() as db:
        acceptance = db.query(ContractAcceptance).filter_by(protocol=protocol).one()
        receipt = json.loads(decrypt_field(acceptance.receipt_snapshot_encrypted))
        assert float(receipt["commercial"]["billingAmount"]) == expected_amount
        setup = get_billing_setup(db, protocol)
        assert setup is not None
        assert setup.payment_method_type == "pix"
        assert setup.billing_cycle == expected_cycle
        assert setup.provider_subscription_id is None


def test_card_authorization_waits_for_essential_setup_before_starting_trial(client_and_session):
    client, Session = client_and_session
    protocol = _accept(client, "pro", "mensal")

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
        assert sub.status == "onboarding"
        assert sub.trial_started_at is None
        assert sub.trial_ends_at is None
        assert sub.current_period_end is None
        entitlement = resolve_tenant_entitlement(db, tenant_id)
        assert entitlement.allowed is True
        assert entitlement.reason == "onboarding_setup"


def test_pix_automatic_cannot_start_a_new_monthly_contract(client_and_session):
    client, Session = client_and_session
    protocol = _accept(client, "pro", "mensal")

    response = client.post(
        f"/api/contracts/{protocol}/billing/setup",
        json={"payment_method_type": "pix_automatic"},
    )
    assert response.status_code == 422, response.text
    assert "Pix Automático legado" in response.text

    with Session() as db:
        setup = get_billing_setup(db, protocol)
        assert setup is None
        assert db.query(SaaSSubscription).count() == 0


def test_pix_automatic_cannot_start_a_new_annual_contract(client_and_session):
    client, _Session = client_and_session
    protocol = _accept(client, "premium", "anual")

    response = client.post(
        f"/api/contracts/{protocol}/billing/setup",
        json={"payment_method_type": "pix_automatic"},
    )
    assert response.status_code == 422, response.text
    assert "Pix Automático legado" in response.text
    assert float(subscription_annual_total("premium")) > float(subscription_monthly_price("premium"))


def test_legacy_upfront_pix_is_rejected_even_for_annual_contract(client_and_session):
    client, Session = client_and_session
    protocol = _accept(client, "pro", "anual")

    response = client.post(
        f"/api/contracts/{protocol}/billing/setup",
        json={"payment_method_type": "pix"},
    )
    assert response.status_code == 422
    assert "Pix universal usa a seleção dedicada" in response.text

    with Session() as db:
        assert get_billing_setup(db, protocol) is None
        assert db.query(Restaurante).count() == 0


def test_webhook_accepts_query_parameters_data_id(client_and_session):
    client, Session = client_and_session
    protocol = _accept(client, "pro", "mensal")
    setup_response = client.post(
        f"/api/contracts/{protocol}/billing/setup",
        json={"payment_method_type": "account_money"},
    )
    subscription_id = setup_response.json()["subscriptionId"]

    webhook = client.post(
        f"/api/integrations/saas-billing/mercado-pago/webhook?data.id={subscription_id}&type=subscription_preapproval",
        json={"action": "updated"},
    )
    assert webhook.status_code == 200, webhook.text

    with Session() as db:
        setup = get_billing_setup(db, protocol)
        assert setup is not None
        assert setup.status == "ready"


def test_webhook_handles_simulation_preapproval_with_200(client_and_session):
    client, _Session = client_and_session
    webhook = client.post(
        "/api/integrations/saas-billing/mercado-pago/webhook?data.id=123456&type=subscription_preapproval",
        json={
            "action": "updated",
            "application_id": "815955951076095",
            "data": {"id": "123456"},
            "date": "2021-11-01T02:02:02Z",
            "entity": "preapproval",
            "id": "123456",
            "type": "subscription_preapproval",
            "version": 0,
        },
    )
    assert webhook.status_code == 200, webhook.text
    assert webhook.json().get("status") == "received"


def test_webhook_handles_simulation_authorized_payment_with_200(client_and_session):
    client, _Session = client_and_session
    webhook = client.post(
        "/api/integrations/saas-billing/mercado-pago/webhook?data.id=123456&type=subscription_authorized_payment",
        json={
            "action": "payment.created",
            "data": {"id": "123456"},
            "type": "subscription_authorized_payment",
        },
    )
    assert webhook.status_code == 200, webhook.text
    assert webhook.json().get("status") == "received"


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
    assert data["account_money"] is True
    assert data["pix"] is False
    assert data["trialDays"] == 7
    assert data["upfrontPaymentAllowed"] is False


def test_account_money_returns_authorization_url_with_zero_due_today(client_and_session):
    client, Session = client_and_session
    protocol = _accept(client, "pro", "mensal")

    response = client.post(
        f"/api/contracts/{protocol}/billing/setup",
        json={"payment_method_type": "account_money"},
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["status"] == "authorization_required"
    assert data["paymentMethodType"] == "account_money"
    assert data["amountDueToday"] == 0
    assert data["trialDays"] == 7
    assert data["authorizationUrl"].startswith("https://www.mercadopago.com.br/")

    with Session() as db:
        setup = get_billing_setup(db, protocol)
        assert setup is not None
        assert setup.payment_method_type == "account_money"
        assert setup.status == "pending"
        assert setup.restaurante_id is None
        assert db.query(SaaSSubscription).count() == 0


def test_account_money_webhook_activates_after_provider_confirms_mandate(client_and_session):
    client, Session = client_and_session
    protocol = _accept(client, "pro", "anual")
    setup_response = client.post(
        f"/api/contracts/{protocol}/billing/setup",
        json={"payment_method_type": "account_money"},
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
        assert setup.payment_method_type == "account_money"
        assert setup.restaurante_id is not None
        sub = db.query(SaaSSubscription).filter(SaaSSubscription.restaurante_id == setup.restaurante_id).one()
        assert sub.status == "onboarding"
        assert sub.trial_started_at is None
        assert sub.trial_ends_at is None
        assert sub.payment_method_type == "account_money"


def test_account_money_rejects_mismatched_payment_method(client_and_session, monkeypatch):
    client, Session = client_and_session
    protocol = _accept(client, "pro", "mensal")
    setup_response = client.post(
        f"/api/contracts/{protocol}/billing/setup",
        json={"payment_method_type": "account_money"},
    )
    subscription_id = setup_response.json()["subscriptionId"]

    # Gateway returns card/visa instead of account_money
    service = saas_billing.default_saas_mp_service
    monkeypatch.setattr(
        service,
        "get_preapproval",
        lambda _sub_id: {
            "id": subscription_id,
            "status": "authorized",
            "payer_id": "payer-test",
            "payment_method_id": "visa",
            "external_reference": protocol,
            "auto_recurring": {
                "frequency": 1,
                "frequency_type": "months",
                "transaction_amount": 129.0,
                "currency_id": "BRL",
                "free_trial": {"frequency": 7, "frequency_type": "days"},
            },
        },
    )

    webhook = client.post(
        "/api/integrations/saas-billing/mercado-pago/webhook",
        json={"type": "subscription_preapproval", "data": {"id": subscription_id}},
    )
    assert webhook.status_code == 409
    assert "não é Saldo Mercado Pago" in webhook.text


@pytest.mark.parametrize("wrong_frequency", [1, 6])
def test_annual_account_money_rejects_wrong_provider_cycle(client_and_session, monkeypatch, wrong_frequency):
    client, Session = client_and_session
    protocol = _accept(client, "pro", "anual")
    setup_response = client.post(
        f"/api/contracts/{protocol}/billing/setup",
        json={"payment_method_type": "account_money"},
    )
    assert setup_response.status_code == 200, setup_response.text
    subscription_id = setup_response.json()["subscriptionId"]
    service = saas_billing.default_saas_mp_service
    original_get = service.get_preapproval

    def wrong_cycle(sub_id):
        mandate = original_get(sub_id)
        return {
            **mandate,
            "auto_recurring": {**mandate["auto_recurring"], "frequency": wrong_frequency},
        }

    monkeypatch.setattr(service, "get_preapproval", wrong_cycle)
    webhook = client.post(
        "/api/integrations/saas-billing/mercado-pago/webhook",
        json={"type": "subscription_preapproval", "data": {"id": subscription_id}},
    )
    assert webhook.status_code == 409
    assert "ciclo diferente" in webhook.text
    with Session() as db:
        setup = get_billing_setup(db, protocol)
        assert setup is not None and setup.status == "pending"
        assert db.query(Restaurante).count() == 0
