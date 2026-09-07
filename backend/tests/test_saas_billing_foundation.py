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

from app.contract_models import ContractAcceptance, RestaurantContractAcceptance
from app.database import Base
from app.legal_config import LEGAL_SOURCE_BLOB_SHA, LEGAL_SOURCE_COMMIT, LEGAL_VERSION
from app.models import ConfiguracaoRestaurante, Restaurante, SuperAdminAuditLog, Usuario
from app.routes import contracts, super_admin_contracts
from app.routes.super_admin_onboarding import restaurant_trials
from app.saas_billing_models import SaaSBillingSetup, SaaSSubscription
from app.services.billing_service import (
    get_billing_setup,
    is_billing_ready,
    resolve_tenant_entitlement,
)


VALID_CPF = "52998224725"
VALID_CNPJ = "11222333000181"


def _documents() -> dict[str, dict]:
    return {
        "terms": {
            "slug": "termos",
            "title": "Termos de Contratação e Uso do KÔMA",
            "version": LEGAL_VERSION,
            "effectiveDate": "05/09/2026",
            "sections": [{"title": "Objeto", "paragraphs": ["Snapshot de teste."]}],
        },
        "commercial": {
            "slug": "planos",
            "title": "Condições Comerciais dos Planos KÔMA",
            "version": LEGAL_VERSION,
            "effectiveDate": "05/09/2026",
            "sections": [{"title": "Preço", "paragraphs": ["Snapshot de teste."]}],
        },
        "dpa": {
            "slug": "dpa",
            "title": "Anexo de Tratamento de Dados",
            "version": LEGAL_VERSION,
            "effectiveDate": "05/09/2026",
            "sections": [{"title": "Papéis", "paragraphs": ["Snapshot de teste."]}],
        },
        "privacy": {
            "slug": "privacidade",
            "title": "Política de Privacidade do KÔMA",
            "version": LEGAL_VERSION,
            "effectiveDate": "05/09/2026",
            "sections": [{"title": "Transparência", "paragraphs": ["Snapshot de teste."]}],
        },
    }


def _contract_payload(restaurant_name: str = "Bistrô Billing Test") -> dict[str, Any]:
    return {
        "request_id": str(uuid.uuid4()),
        "contracting_party_name": "Restaurante Billing Ltda",
        "contracting_party_tax_id": VALID_CNPJ,
        "restaurant_name": restaurant_name,
        "representative_name": "Responsável Billing",
        "representative_tax_id": VALID_CPF,
        "representative_role": "Sócio administrador",
        "email": f"billing-{uuid.uuid4().hex[:6]}@example.com",
        "phone": "85999999999",
        "plan": "pro",
        "billing_cycle": "anual",
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
    RestaurantContractAcceptance.__table__.create(engine)
    SaaSBillingSetup.__table__.create(engine)
    SaaSSubscription.__table__.create(engine)

    TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    monkeypatch.setattr(contracts, "SessionLocal", TestingSessionLocal)
    monkeypatch.setattr(super_admin_contracts, "SessionLocal", TestingSessionLocal)

    monkeypatch.setenv("KOMA_LEGAL_PROVIDER_NAME", "Prestador de Teste")
    monkeypatch.setenv("KOMA_LEGAL_PROVIDER_TAX_ID", VALID_CPF)
    monkeypatch.setenv("KOMA_LEGAL_PROVIDER_ADDRESS", "Endereço jurídico de teste, 100")
    monkeypatch.setenv("KOMA_LEGAL_PROVIDER_LOCATION", "Limoeiro do Norte/CE")

    app = FastAPI()
    app.include_router(contracts.router)
    app.include_router(super_admin_contracts.router, prefix="/api/super-admin")
    app.dependency_overrides[super_admin_contracts.get_current_admin] = lambda: {
        "user": "billing-test-superadmin"
    }

    with TestClient(app) as client:
        yield client, TestingSessionLocal
    engine.dispose()


def _accept_contract(client: TestClient, restaurant_name: str = "Bistrô Billing Test") -> str:
    accepted = client.post("/api/contracts/accept", json=_contract_payload(restaurant_name))
    assert accepted.status_code == 201, accepted.text
    return accepted.json()["protocol"]


def test_billing_enforcement_enabled_blocks_pending_billing(client_and_session, monkeypatch):
    client, Session = client_and_session
    monkeypatch.setattr(
        super_admin_contracts,
        "is_billing_enforcement_enabled",
        lambda: True,
    )

    protocol = _accept_contract(client, "Bistrô Sem Cartão")

    # Tenta ativar sem billing configurado -> 409 Conflict
    response = client.post(
        f"/api/super-admin/contracts/{protocol}/activate",
        json={"reason": "Tentativa de ativação sem billing"},
    )
    assert response.status_code == 409
    assert "billing ready" in response.json()["detail"].lower()

    # Confirma que nenhum restaurante foi provisionado
    with Session() as db:
        assert db.query(Restaurante).count() == 0
        assert db.query(Usuario).count() == 0
        assert db.query(SaaSSubscription).count() == 0


def test_billing_enforcement_enabled_allows_ready_billing(client_and_session, monkeypatch):
    client, Session = client_and_session
    monkeypatch.setattr(
        super_admin_contracts,
        "is_billing_enforcement_enabled",
        lambda: True,
    )

    protocol = _accept_contract(client, "Bistrô Com Cartão")

    # Cria setup de billing com status 'ready'
    with Session() as db:
        billing = SaaSBillingSetup(
            protocol=protocol,
            provider="mercado_pago",
            payment_method_type="credit_card",
            status="ready",
            provider_customer_id="cust_12345",
            provider_payment_method_reference="card_token_xyz",
            provider_subscription_id="sub_mp_999",
            billing_cycle="annual",
        )
        db.add(billing)
        db.commit()

    # Agora a ativação deve ter sucesso
    response = client.post(
        f"/api/super-admin/contracts/{protocol}/activate",
        json={"reason": "Ativação com cartão confirmado"},
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["idempotent"] is False
    assert data["billingStatus"] == "ready"
    restaurant_id = int(data["restaurantId"])

    with Session() as db:
        # Verifica vínculo do setup de billing ao tenant criado
        setup = get_billing_setup(db, protocol)
        assert setup is not None
        assert setup.restaurante_id == restaurant_id

        # Verifica criação da assinatura canônica
        sub = db.query(SaaSSubscription).filter_by(restaurante_id=restaurant_id).one()
        assert sub.status == "trialing"
        assert sub.provider == "mercado_pago"
        assert sub.payment_method_type == "credit_card"
        assert sub.billing_cycle == "anual"


def test_backward_compatibility_when_enforcement_disabled(client_and_session, monkeypatch):
    client, Session = client_and_session
    monkeypatch.setattr(
        super_admin_contracts,
        "is_billing_enforcement_enabled",
        lambda: False,
    )
    monkeypatch.setattr(
        "app.services.billing_service.is_billing_enforcement_enabled",
        lambda: False,
    )

    protocol = _accept_contract(client, "Bistrô Legado")

    # Ativação deve suceder mesmo sem setup de billing prévio quando enforcement estiver False
    response = client.post(
        f"/api/super-admin/contracts/{protocol}/activate",
        json={"reason": "Ativação em ambiente com enforcement desativado"},
    )
    assert response.status_code == 200, response.text
    restaurant_id = int(response.json()["restaurantId"])

    with Session() as db:
        # Tenant foi criado com billing_mode='subscription'
        restaurante = db.query(Restaurante).filter_by(id=restaurant_id).one()
        assert restaurante.saas_status == "active"
        assert restaurante.billing_mode == "subscription"

        # Eliminação de assinatura fake: SEM billing pronto, nenhuma SaaSSubscription é criada
        sub = db.query(SaaSSubscription).filter_by(restaurante_id=restaurant_id).one_or_none()
        assert sub is None

        # Entitlement resolve como transicional quando enforcement está desligado
        entitlement = resolve_tenant_entitlement(db, restaurant_id)
        assert entitlement.allowed is True
        assert entitlement.reason == "enforcement_disabled_transitional"

    # Agora simula ativação do enforcement: restaurante novo sem assinatura deve falhar closed
    monkeypatch.setattr(
        "app.services.billing_service.is_billing_enforcement_enabled",
        lambda: True,
    )
    with Session() as db:
        entitlement_blocked = resolve_tenant_entitlement(db, restaurant_id)
        assert entitlement_blocked.allowed is False
        assert entitlement_blocked.reason == "subscription_required"
        assert entitlement_blocked.billing_status == "subscription_required"

        # Já restaurantes legados continuam permitidos mesmo com enforcement True
        r_legacy = Restaurante(id=999, nome="Legado", slug="legado", plano="pro", saas_status="active", billing_mode="legacy")
        db.add(r_legacy)
        db.commit()

        legacy_entitlement = resolve_tenant_entitlement(db, 999)
        assert legacy_entitlement.allowed is True
        assert legacy_entitlement.reason == "legacy_grandfathered"
        assert legacy_entitlement.billing_status == "active"


def test_super_admin_inbox_and_preview_expose_billing_metadata(client_and_session):
    client, Session = client_and_session

    p1 = _accept_contract(client, "Bistrô Inbox Um")
    p2 = _accept_contract(client, "Bistrô Inbox Dois")

    with Session() as db:
        # p1 com billing pronto
        db.add(
            SaaSBillingSetup(
                protocol=p1,
                provider="mercado_pago",
                payment_method_type="credit_card",
                status="ready",
            )
        )
        # p2 com billing pendente
        db.add(
            SaaSBillingSetup(
                protocol=p2,
                provider="mercado_pago",
                payment_method_type="pix",
                status="pending",
            )
        )
        db.commit()

    inbox = client.get("/api/super-admin/contracts?status=all")
    assert inbox.status_code == 200
    items = {item["protocol"]: item for item in inbox.json()["items"]}

    assert items[p1]["billingStatus"] == "ready"
    assert items[p1]["paymentMethodType"] == "credit_card"
    assert "activationEligible" in items[p1]
    assert "billingEnforcementEnabled" in items[p1]

    assert items[p2]["billingStatus"] == "pending"
    assert items[p2]["paymentMethodType"] == "pix"

    preview = client.get(f"/api/super-admin/contracts/preview/{p1}")
    assert preview.status_code == 200
    assert preview.json()["billingStatus"] == "ready"
    assert "activationEligible" in preview.json()
    assert "billingEnforcementEnabled" in preview.json()


def test_entitlement_resolution_lifecycle(client_and_session):
    _, Session = client_and_session
    now = datetime.datetime.now(datetime.timezone.utc)

    with Session() as db:
        # Tenant 1: trialing ativo
        r1 = Restaurante(id=101, nome="Tenant 101", slug="t101", plano="pocket", saas_status="active")
        s1 = SaaSSubscription(
            restaurante_id=101,
            status="trialing",
            trial_started_at=now - datetime.timedelta(days=2),
            trial_ends_at=now + datetime.timedelta(days=5),
        )
        db.add_all([r1, s1])

        # Tenant 2: trialing expirado
        r2 = Restaurante(id=102, nome="Tenant 102", slug="t102", plano="pocket", saas_status="active")
        s2 = SaaSSubscription(
            restaurante_id=102,
            status="trialing",
            trial_started_at=now - datetime.timedelta(days=10),
            trial_ends_at=now - datetime.timedelta(days=3),
        )
        db.add_all([r2, s2])

        # Tenant 3: past_due dentro do grace period
        r3 = Restaurante(id=103, nome="Tenant 103", slug="t103", plano="pro", saas_status="active")
        s3 = SaaSSubscription(
            restaurante_id=103,
            status="past_due",
            grace_until=now + datetime.timedelta(days=2),
        )
        db.add_all([r3, s3])

        # Tenant 4: past_due grace period expirado
        r4 = Restaurante(id=104, nome="Tenant 104", slug="t104", plano="pro", saas_status="active")
        s4 = SaaSSubscription(
            restaurante_id=104,
            status="past_due",
            grace_until=now - datetime.timedelta(hours=1),
        )
        db.add_all([r4, s4])

        # Tenant 5: ativo regular
        r5 = Restaurante(id=105, nome="Tenant 105", slug="t105", plano="premium", saas_status="active")
        s5 = SaaSSubscription(
            restaurante_id=105,
            status="active",
        )
        db.add_all([r5, s5])

        # Tenant 6: suspenso
        r6 = Restaurante(id=106, nome="Tenant 106", slug="t106", plano="premium", saas_status="suspended")
        s6 = SaaSSubscription(
            restaurante_id=106,
            status="suspended",
        )
        db.add_all([r6, s6])

        db.commit()

        # Validações de entitlement
        e1 = resolve_tenant_entitlement(db, 101)
        assert e1.allowed is True
        assert e1.reason == "trial_active"

        e2 = resolve_tenant_entitlement(db, 102)
        assert e2.allowed is False
        assert e2.reason == "trial_expired"

        e3 = resolve_tenant_entitlement(db, 103)
        assert e3.allowed is True
        assert e3.reason == "past_due_in_grace"

        e4 = resolve_tenant_entitlement(db, 104)
        assert e4.allowed is False
        assert e4.reason == "past_due_grace_expired"

        e5 = resolve_tenant_entitlement(db, 105)
        assert e5.allowed is True
        assert e5.reason == "subscription_active"

        e6 = resolve_tenant_entitlement(db, 106)
        assert e6.allowed is False
        assert e6.reason == "tenant_suspended"
