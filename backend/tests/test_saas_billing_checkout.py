from __future__ import annotations

import datetime
import json
import uuid
from typing import Any

import pytest
from fastapi import Depends, FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import settings
from app.contract_models import ContractAcceptance, RestaurantContractAcceptance
from app.database import Base, get_db
from app.legal_config import LEGAL_SOURCE_BLOB_SHA, LEGAL_SOURCE_COMMIT, LEGAL_VERSION
from app.models import ConfiguracaoRestaurante, Restaurante, SuperAdminAuditLog, Usuario
from app.routes import contracts, saas_billing, super_admin_contracts
from app.routes.super_admin_onboarding import restaurant_trials
from app.saas_billing_models import SaaSBillingSetup, SaaSSubscription
from app.security import require_active_subscription
from app.services.billing_service import (
    get_billing_setup,
    is_billing_ready,
    resolve_tenant_entitlement,
)
from app.subscription import subscription_annual_total

VALID_CPF = "52998224725"
VALID_CNPJ = "11222333000181"


def _documents() -> dict[str, dict]:
    return {
        "terms": {
            "slug": "termos",
            "title": "Termos de Contratação",
            "version": LEGAL_VERSION,
            "sections": [{"title": "Objeto", "paragraphs": ["Snapshot de teste."]}],
        },
        "commercial": {
            "slug": "planos",
            "title": "Condições Comerciais",
            "version": LEGAL_VERSION,
            "sections": [{"title": "Preço", "paragraphs": ["Snapshot de teste."]}],
        },
        "dpa": {
            "slug": "dpa",
            "title": "Anexo de Tratamento de Dados",
            "version": LEGAL_VERSION,
            "sections": [{"title": "Papéis", "paragraphs": ["Snapshot de teste."]}],
        },
        "privacy": {
            "slug": "privacidade",
            "title": "Política de Privacidade",
            "version": LEGAL_VERSION,
            "sections": [{"title": "Transparência", "paragraphs": ["Snapshot de teste."]}],
        },
    }


def _contract_payload(plan: str = "pro", billing_cycle: str = "mensal") -> dict[str, Any]:
    return {
        "request_id": str(uuid.uuid4()),
        "contracting_party_name": "Bistrô Sandbox Teste Ltda",
        "contracting_party_tax_id": VALID_CNPJ,
        "restaurant_name": "Bistrô Sandbox",
        "representative_name": "Gestor Sandbox",
        "representative_tax_id": VALID_CPF,
        "representative_role": "Administrador",
        "email": f"sandbox-{uuid.uuid4().hex[:6]}@example.com",
        "phone": "85988887777",
        "plan": plan,
        "billing_cycle": billing_cycle,
        "powers_declared": True,
        "legal_version": LEGAL_VERSION,
        "legal_source_commit": LEGAL_SOURCE_COMMIT,
        "legal_source_blob_sha": LEGAL_SOURCE_BLOB_SHA,
        "documents": _documents(),
    }


def _verified_pix_payment(payment_id: str, protocol: str, plan: str = "pocket") -> dict[str, Any]:
    return {
        "id": payment_id,
        "status": "approved",
        "payment_method_id": "pix",
        "external_reference": protocol,
        "transaction_amount": float(subscription_annual_total(plan)),
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
    RestaurantContractAcceptance.__table__.create(engine)
    SaaSBillingSetup.__table__.create(engine)
    SaaSSubscription.__table__.create(engine)

    Session = sessionmaker(bind=engine, autocommit=False, autoflush=False)

    monkeypatch.setattr(contracts, "SessionLocal", Session)
    monkeypatch.setattr(super_admin_contracts, "SessionLocal", Session)
    monkeypatch.setattr(saas_billing, "SessionLocal", Session)

    monkeypatch.setenv("KOMA_LEGAL_PROVIDER_NAME", "Prestador de Teste")
    monkeypatch.setenv("KOMA_LEGAL_PROVIDER_TAX_ID", VALID_CPF)
    monkeypatch.setenv("KOMA_LEGAL_PROVIDER_ADDRESS", "Endereço jurídico de teste, 100")
    monkeypatch.setenv("KOMA_LEGAL_PROVIDER_LOCATION", "Limoeiro do Norte/CE")

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

    # Rota protegida por paywall operacional para testar require_active_subscription
    @app.get("/api/test-protected-operation")
    def protected_op(user: Usuario = Depends(require_active_subscription)):
        return {"status": "ok", "user": user.email}

    client = TestClient(app)
    return client, Session


def test_credit_card_checkout_activates_tenant_immediately_with_seven_days_trial(client_and_session):
    client, Session = client_and_session

    # 1. Aceite eletrônico do contrato
    accept_resp = client.post("/api/contracts/accept", json=_contract_payload("pocket", "mensal"))
    assert accept_resp.status_code == 201
    protocol = accept_resp.json()["protocol"]

    # 2. Configuração de cartão no checkout (Arquitetura B)
    setup_resp = client.post(
        f"/api/contracts/{protocol}/billing/setup",
        json={
            "payment_method_type": "credit_card",
            "card_token_id": "tok_test_card_12345",
        },
    )
    assert setup_resp.status_code == 200, setup_resp.text
    data = setup_resp.json()

    assert data["success"] is True
    assert data["status"] == "ready"
    assert data["trialDays"] == 7
    assert data["slug"].startswith("bistro-sandbox-")
    assert "activationToken" in data
    assert bool(data["activationToken"])
    tenant_id = int(data["restaurantId"])
    assert tenant_id > 0

    # 3. Verificação no banco de dados
    with Session() as db:
        # Restaurante provisionado com billing_mode subscription
        rest = db.query(Restaurante).filter(Restaurante.id == tenant_id).one()
        assert rest.billing_mode == "subscription"
        assert rest.saas_status == "active"
        assert rest.plano == "pocket"

        # Trial de 7 dias registrado
        trial = db.execute(
            restaurant_trials.select().where(restaurant_trials.c.restaurante_id == tenant_id)
        ).mappings().one()
        assert trial["trial_status"] == "active"

        # Usuário inicial com token convite
        admin_user = db.query(Usuario).filter(Usuario.restaurante_id == tenant_id).one()
        assert admin_user.cargo == "admin"
        assert admin_user.status == "pendente_ativacao"
        assert admin_user.token_convite is not None
        assert data["activationToken"] == admin_user.token_convite

        # SaaSBillingSetup está pronto
        setup = get_billing_setup(db, protocol)
        assert setup is not None
        assert setup.status == "ready"
        assert setup.provider == "mercado_pago"
        assert setup.payment_method_type == "credit_card"
        assert setup.restaurante_id == tenant_id

        # SaaSSubscription canônica em trialing
        sub = db.query(SaaSSubscription).filter(SaaSSubscription.restaurante_id == tenant_id).one()
        assert sub.status == "trialing"
        assert sub.billing_cycle in ("mensal", "monthly")
        assert sub.trial_ends_at is not None

        # Entitlement permite operação
        ent = resolve_tenant_entitlement(db, tenant_id)
        assert ent.allowed is True
        assert ent.reason == "trial_active"


def test_billing_setup_idempotency_after_activation(client_and_session):
    client, Session = client_and_session
    accept_resp = client.post("/api/contracts/accept", json=_contract_payload("pro", "mensal"))
    protocol = accept_resp.json()["protocol"]

    # Primeiro setup
    first = client.post(
        f"/api/contracts/{protocol}/billing/setup",
        json={"payment_method_type": "credit_card", "card_token_id": "tok_123"},
    )
    assert first.status_code == 200

    # Segundo setup (duplo clique ou retry)
    second = client.post(
        f"/api/contracts/{protocol}/billing/setup",
        json={"payment_method_type": "credit_card", "card_token_id": "tok_123"},
    )
    assert second.status_code == 200
    assert second.json()["status"] == "already_activated"
    assert second.json()["restaurantId"] == first.json()["restaurantId"]


def test_pix_billing_setup_requires_annual_cycle(client_and_session):
    client, Session = client_and_session

    # Contrato mensal com Pix deve falhar
    accept_monthly = client.post("/api/contracts/accept", json=_contract_payload("pro", "mensal"))
    protocol_monthly = accept_monthly.json()["protocol"]
    resp_monthly = client.post(
        f"/api/contracts/{protocol_monthly}/billing/setup",
        json={"payment_method_type": "pix"},
    )
    assert resp_monthly.status_code == 422
    assert "exclusivamente para o plano anual" in resp_monthly.text

    # Contrato anual com Pix deve gerar código e status pending
    accept_annual = client.post("/api/contracts/accept", json=_contract_payload("pro", "anual"))
    protocol_annual = accept_annual.json()["protocol"]
    resp_annual = client.post(
        f"/api/contracts/{protocol_annual}/billing/setup",
        json={"payment_method_type": "pix"},
    )
    assert resp_annual.status_code == 200
    data = resp_annual.json()
    assert data["status"] == "pending"
    assert data["paymentMethodType"] == "pix"
    assert data["paymentId"].startswith("mock-pix-")
    assert "br.gov.bcb.pix" in data["qrCode"]
    assert "activationToken" not in data

    with Session() as db:
        setup = get_billing_setup(db, protocol_annual)
        assert setup is not None
        assert setup.status == "pending"
        # Restaurante NÃO foi ativado ainda (aguarda pagamento)
        assert setup.restaurante_id is None


def test_webhook_pix_approval_activates_tenant_only_after_provider_verification(client_and_session, monkeypatch):
    client, Session = client_and_session
    accept_resp = client.post("/api/contracts/accept", json=_contract_payload("pocket", "anual"))
    protocol = accept_resp.json()["protocol"]

    setup_resp = client.post(
        f"/api/contracts/{protocol}/billing/setup",
        json={"payment_method_type": "pix"},
    )
    payment_id = setup_resp.json()["paymentId"]
    monkeypatch.setattr(
        saas_billing.default_saas_mp_service,
        "get_payment",
        lambda provider_payment_id: _verified_pix_payment(provider_payment_id, protocol, "pocket"),
    )

    webhook_payload = {
        "action": "payment.updated",
        "type": "payment",
        "data": {"id": payment_id},
    }
    resp_wh = client.post(
        "/api/integrations/saas-billing/mercado-pago/webhook",
        json=webhook_payload,
    )
    assert resp_wh.status_code == 200
    assert resp_wh.json()["activated"] is True
    assert resp_wh.json()["paymentStatus"] == "approved"

    with Session() as db:
        setup = get_billing_setup(db, protocol)
        assert setup.status == "ready"
        assert setup.restaurante_id is not None

        # Restaurante e assinatura ativados
        sub = db.query(SaaSSubscription).filter(
            SaaSSubscription.restaurante_id == setup.restaurante_id
        ).one()
        assert sub.status == "active"
        assert sub.payment_method_type == "pix"
        rest = db.query(Restaurante).filter(Restaurante.id == setup.restaurante_id).one()
        assert rest.slug

    status_resp = client.get(f"/api/contracts/{protocol}/billing/status")
    assert status_resp.status_code == 200
    status_data = status_resp.json()
    assert status_data["isActivated"] is True
    assert status_data["slug"]


def test_webhook_pix_pending_provider_status_does_not_activate(client_and_session):
    client, Session = client_and_session
    accept_resp = client.post("/api/contracts/accept", json=_contract_payload("pro", "anual"))
    protocol = accept_resp.json()["protocol"]
    setup_resp = client.post(
        f"/api/contracts/{protocol}/billing/setup",
        json={"payment_method_type": "pix"},
    )
    payment_id = setup_resp.json()["paymentId"]

    resp_wh = client.post(
        "/api/integrations/saas-billing/mercado-pago/webhook",
        json={"type": "payment", "action": "payment.updated", "data": {"id": payment_id}},
    )
    assert resp_wh.status_code == 200
    assert resp_wh.json()["activated"] is False
    assert resp_wh.json()["paymentStatus"] == "pending"

    with Session() as db:
        setup = get_billing_setup(db, protocol)
        assert setup.status == "pending"
        assert setup.restaurante_id is None
        assert db.query(SaaSSubscription).count() == 0


def test_webhook_pix_rejects_reference_mismatch(client_and_session, monkeypatch):
    client, Session = client_and_session
    accept_resp = client.post("/api/contracts/accept", json=_contract_payload("pocket", "anual"))
    protocol = accept_resp.json()["protocol"]
    setup_resp = client.post(
        f"/api/contracts/{protocol}/billing/setup",
        json={"payment_method_type": "pix"},
    )
    payment_id = setup_resp.json()["paymentId"]
    monkeypatch.setattr(
        saas_billing.default_saas_mp_service,
        "get_payment",
        lambda provider_payment_id: {
            **_verified_pix_payment(provider_payment_id, protocol, "pocket"),
            "external_reference": "KOMA-CTR-20000101-AAAAAAAAAAAA",
        },
    )

    resp_wh = client.post(
        "/api/integrations/saas-billing/mercado-pago/webhook",
        json={"type": "payment", "data": {"id": payment_id}},
    )
    assert resp_wh.status_code == 200
    assert resp_wh.json() == {
        "status": "received",
        "activated": False,
        "reason": "external_reference_mismatch",
    }

    with Session() as db:
        setup = get_billing_setup(db, protocol)
        assert setup.status == "pending"
        assert setup.restaurante_id is None


def test_webhook_pix_rejects_amount_mismatch(client_and_session, monkeypatch):
    client, Session = client_and_session
    accept_resp = client.post("/api/contracts/accept", json=_contract_payload("premium", "anual"))
    protocol = accept_resp.json()["protocol"]
    setup_resp = client.post(
        f"/api/contracts/{protocol}/billing/setup",
        json={"payment_method_type": "pix"},
    )
    payment_id = setup_resp.json()["paymentId"]
    monkeypatch.setattr(
        saas_billing.default_saas_mp_service,
        "get_payment",
        lambda provider_payment_id: {
            **_verified_pix_payment(provider_payment_id, protocol, "premium"),
            "transaction_amount": 1.00,
        },
    )

    resp_wh = client.post(
        "/api/integrations/saas-billing/mercado-pago/webhook",
        json={"type": "payment", "data": {"id": payment_id}},
    )
    assert resp_wh.status_code == 200
    assert resp_wh.json() == {
        "status": "received",
        "activated": False,
        "reason": "amount_mismatch",
    }

    with Session() as db:
        setup = get_billing_setup(db, protocol)
        assert setup.status == "pending"
        assert setup.restaurante_id is None


def test_operational_paywall_blocks_suspended_and_expired(client_and_session):
    client, Session = client_and_session
    accept_resp = client.post("/api/contracts/accept", json=_contract_payload("pro", "mensal"))
    protocol = accept_resp.json()["protocol"]

    setup_resp = client.post(
        f"/api/contracts/{protocol}/billing/setup",
        json={"payment_method_type": "credit_card", "card_token_id": "tok_123"},
    )
    tenant_id = int(setup_resp.json()["restaurantId"])

    with Session() as db:
        user = db.query(Usuario).filter(Usuario.restaurante_id == tenant_id).first()
        user_id = user.id

        # 1. Durante o trial: permitido
        ent = resolve_tenant_entitlement(db, tenant_id)
        assert ent.allowed is True

        # 2. Em past_due dentro do grace period: permitido
        sub = db.query(SaaSSubscription).filter(SaaSSubscription.restaurante_id == tenant_id).one()
        now = datetime.datetime.now(datetime.timezone.utc)
        sub.status = "past_due"
        sub.grace_until = now + datetime.timedelta(days=2)
        db.commit()

        ent_grace = resolve_tenant_entitlement(db, tenant_id)
        assert ent_grace.allowed is True
        assert ent_grace.reason == "past_due_in_grace"

        # 3. Em past_due após expirar grace period: BLOQUEADO
        sub.grace_until = now - datetime.timedelta(hours=1)
        db.commit()

        ent_expired = resolve_tenant_entitlement(db, tenant_id)
        assert ent_expired.allowed is False
        assert ent_expired.reason == "past_due_grace_expired"

        # 4. Suspenso: BLOQUEADO
        sub.status = "suspended"
        db.commit()

        ent_suspended = resolve_tenant_entitlement(db, tenant_id)
        assert ent_suspended.allowed is False
        assert ent_suspended.reason == "tenant_suspended"
