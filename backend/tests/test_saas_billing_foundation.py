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

from app.contract_models import ContractAcceptance, RestaurantContractAcceptance
from app.crypt import decrypt_field, encrypt_field
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


def _contract_payload(
    restaurant_name: str = "Bistrô Billing Test",
    *,
    plan: str = "pro",
    billing_cycle: str = "anual",
) -> dict[str, Any]:
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


def _accept_contract(
    client: TestClient,
    restaurant_name: str = "Bistrô Billing Test",
    *,
    plan: str = "pro",
    billing_cycle: str = "anual",
) -> str:
    accepted = client.post(
        "/api/contracts/accept",
        json=_contract_payload(
            restaurant_name,
            plan=plan,
            billing_cycle=billing_cycle,
        ),
    )
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
        assert sub.status == "onboarding"
        assert sub.provider == "mercado_pago"
        assert sub.payment_method_type == "credit_card"
        assert sub.billing_cycle == "anual"


def test_billing_enforcement_treats_free_pocket_as_not_required(client_and_session, monkeypatch):
    client, Session = client_and_session
    monkeypatch.setattr(
        super_admin_contracts,
        "is_billing_enforcement_enabled",
        lambda: True,
    )
    monkeypatch.setattr(
        "app.services.billing_service.is_billing_enforcement_enabled",
        lambda: True,
    )

    protocol = _accept_contract(
        client,
        "Pocket Sem Mensalidade",
        plan="pocket",
        billing_cycle="mensal",
    )

    # Aceite anterior ao novo catálogo: o snapshot de R$ 0 segue sem cobrança.
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

    preview = client.get(f"/api/super-admin/contracts/preview/{protocol}")
    assert preview.status_code == 200, preview.text
    preview_data = preview.json()
    assert preview_data["billingStatus"] == "not_required"
    assert preview_data["billingEnforcementEnabled"] is True
    assert preview_data["activationEligible"] is True
    assert preview_data["billingProvider"] is None
    assert preview_data["paymentMethodType"] is None

    activated = client.post(
        f"/api/super-admin/contracts/{protocol}/activate",
        json={"reason": "Ativação Pocket gratuito com enforcement ligado"},
    )
    assert activated.status_code == 200, activated.text
    data = activated.json()
    assert data["billingStatus"] == "not_required"
    assert "billingProvider" not in data
    assert "paymentMethodType" not in data
    assert "trial" not in data

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


def test_enforcement_flag_does_not_bypass_fixed_billing_for_new_contracts(
    client_and_session,
    monkeypatch,
):
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

    protocol = _accept_contract(client, "Bistrô com cobrança fixa")

    # Desde a verdade comercial atual, toda contratação nova possui componente
    # fixo. A flag de enforcement pode governar tenants existentes, mas nunca
    # autoriza provisionar um contrato pago sem billing ready.
    response = client.post(
        f"/api/super-admin/contracts/{protocol}/activate",
        json={"reason": "Tentativa sem billing pronto"},
    )
    assert response.status_code == 409
    assert "billing ready" in response.json()["detail"].lower()

    with Session() as db:
        transitional = Restaurante(
            id=998,
            nome="Transicional",
            slug="transicional",
            plano="pro",
            saas_status="active",
            billing_mode="subscription",
        )
        legacy = Restaurante(
            id=999,
            nome="Legado",
            slug="legado",
            plano="pro",
            saas_status="active",
            billing_mode="legacy",
        )
        db.add_all([transitional, legacy])
        db.commit()

        entitlement = resolve_tenant_entitlement(db, 998)
        assert entitlement.allowed is True
        assert entitlement.reason == "enforcement_disabled_transitional"

        legacy_entitlement = resolve_tenant_entitlement(db, 999)
        assert legacy_entitlement.allowed is True
        assert legacy_entitlement.reason == "legacy_grandfathered"

    monkeypatch.setattr(
        "app.services.billing_service.is_billing_enforcement_enabled",
        lambda: True,
    )
    with Session() as db:
        blocked = resolve_tenant_entitlement(db, 998)
        assert blocked.allowed is False
        assert blocked.reason == "subscription_required"
        assert blocked.billing_status == "subscription_required"

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

        # Tenant 6: suspenso administrativamente, mesmo com estado
        # financeiro que poderia ser confundido com pausa técnica de onboarding.
        r6 = Restaurante(id=106, nome="Tenant 106", slug="t106", plano="premium", saas_status="suspended")
        s6 = SaaSSubscription(
            restaurante_id=106,
            status="suspended",
        )
        db.add_all([r6, s6])

        # Tenant 7: suspensão administrativa também vence assinatura ativa.
        r7 = Restaurante(id=107, nome="Tenant 107", slug="t107", plano="premium", saas_status="suspended")
        s7 = SaaSSubscription(
            restaurante_id=107,
            status="active",
        )
        db.add_all([r7, s7])

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

        e7 = resolve_tenant_entitlement(db, 107)
        assert e7.allowed is False
        assert e7.reason == "tenant_suspended"
        assert e7.billing_status == "suspended"
