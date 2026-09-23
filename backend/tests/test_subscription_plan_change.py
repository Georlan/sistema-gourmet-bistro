from __future__ import annotations

import datetime as dt
import json
import uuid
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import settings
from app.contract_models import ContractAcceptance, RestaurantContractAcceptance
from app.crypt import decrypt_field, encrypt_field
from app.database import current_restaurante_id, get_db
from app.legal_config import LEGAL_SOURCE_BLOB_SHA, LEGAL_SOURCE_COMMIT, LEGAL_VERSION
from app.models import Restaurante, SuperAdminAuditLog
from app.routes import contracts, saas_billing, subscription_account, super_admin_contracts
from app.saas_billing_models import SaaSPlanChange, SaaSSubscription
from app.services.billing_service import tenant_commercial_terms
from app.services.online_payments.service import OnlinePaymentService
from app.services.restaurant_provisioning import resolve_activation_acceptance
from app.services.saas_mercadopago import default_saas_mp_service
from app.signup_models import SignupBase


TENANT_ID = 7742
VALID_CPF = "52998224725"
VALID_CNPJ = "11222333000181"


def _documents() -> dict[str, dict]:
    return {
        "terms": {"slug": "termos", "version": LEGAL_VERSION, "sections": []},
        "commercial": {"slug": "planos", "version": LEGAL_VERSION, "sections": []},
        "dpa": {"slug": "dpa", "version": LEGAL_VERSION, "sections": []},
        "privacy": {"slug": "privacidade", "version": LEGAL_VERSION, "sections": []},
    }


def _payload(plan: str, billing_cycle: str = "mensal") -> dict:
    return {
        "request_id": str(uuid.uuid4()),
        "contracting_party_name": "Restaurante Migração Ltda",
        "contracting_party_tax_id": VALID_CNPJ,
        "restaurant_name": "Restaurante Migração",
        "representative_name": "Responsável Migração",
        "representative_tax_id": VALID_CPF,
        "representative_role": "Sócio administrador",
        "email": "admin-migracao@koma.test",
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
def plan_change_env(monkeypatch):
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Restaurante.__table__.create(engine)
    SuperAdminAuditLog.__table__.create(engine)
    ContractAcceptance.__table__.create(engine)
    SignupBase.metadata.create_all(engine)
    RestaurantContractAcceptance.__table__.create(engine)
    SaaSSubscription.__table__.create(engine)
    SaaSPlanChange.__table__.create(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    monkeypatch.setattr(contracts, "SessionLocal", Session)
    monkeypatch.setattr(super_admin_contracts, "SessionLocal", Session)
    monkeypatch.setenv("KOMA_LEGAL_PROVIDER_NAME", "KÔMA Testes")
    monkeypatch.setenv("KOMA_LEGAL_PROVIDER_TAX_ID", VALID_CPF)
    monkeypatch.setenv("KOMA_LEGAL_PROVIDER_ADDRESS", "Rua Teste, 100")
    monkeypatch.setenv("KOMA_LEGAL_PROVIDER_LOCATION", "Fortaleza/CE")
    monkeypatch.setattr(settings, "ONLINE_PAYMENT_PLAN_FEES_ENABLED", True)

    app = FastAPI()
    app.include_router(contracts.router)
    app.include_router(saas_billing.router)
    app.include_router(subscription_account.router)
    app.include_router(super_admin_contracts.router, prefix="/api/super-admin")

    def override_get_db():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    admin = SimpleNamespace(
        id="tenant-admin-plan-change",
        restaurante_id=TENANT_ID,
        cargo="admin",
        email="admin-migracao@koma.test",
    )
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[subscription_account.administrator] = lambda: admin
    app.dependency_overrides[super_admin_contracts.get_current_admin] = lambda: {
        "user": "superadmin-plan-change-test"
    }

    token = current_restaurante_id.set(TENANT_ID)
    try:
        with TestClient(app) as client:
            yield client, Session
    finally:
        current_restaurante_id.reset(token)
        engine.dispose()


def _seed_legacy_pro(client: TestClient, Session, *, payment_method: str = "credit_card", provider_ref: str | None = "mock-pro-v25"):
    accepted = client.post("/api/contracts/accept", json=_payload("pro"))
    assert accepted.status_code == 201, accepted.text
    protocol = accepted.json()["protocol"]

    db = Session()
    try:
        acceptance = (
            db.query(ContractAcceptance)
            .filter(ContractAcceptance.protocol == protocol)
            .one()
        )
        receipt = json.loads(decrypt_field(acceptance.receipt_snapshot_encrypted))
        receipt["commercial"].pop("pricingVersion", None)
        receipt["commercial"]["fixedMonthlyPrice"] = "209.00"
        receipt["commercial"]["billingAmount"] = "209.00"
        receipt["commercial"]["annualMonthlyEquivalent"] = None
        receipt["commercial"]["marketplaceRate"] = "0.006900"
        receipt["commercial"]["fixedBillingRequired"] = True
        receipt["commercial"]["trialDays"] = 7
        receipt["documents"]["version"] = "2.5"
        acceptance.fixed_monthly_price = Decimal("209.00")
        acceptance.billing_amount = Decimal("209.00")
        acceptance.annual_monthly_equivalent = None
        acceptance.marketplace_rate = Decimal("0.0069")
        acceptance.legal_version = "2.5"
        acceptance.receipt_snapshot_encrypted = encrypt_field(
            json.dumps(receipt, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        )

        db.add(
            Restaurante(
                id=TENANT_ID,
                nome="Restaurante Migração",
                plano="pro",
                billing_mode="subscription",
                saas_status="active",
            )
        )
        db.flush()
        db.add(
            RestaurantContractAcceptance(
                id=str(uuid.uuid4()),
                restaurante_id=TENANT_ID,
                acceptance_id=acceptance.id,
                linked_at=dt.datetime(2026, 9, 1, tzinfo=dt.timezone.utc),
            )
        )
        db.add(
            SaaSSubscription(
                restaurante_id=TENANT_ID,
                provider="mercado_pago",
                provider_subscription_id=provider_ref,
                payment_method_type=payment_method,
                billing_cycle="mensal",
                status="active",
                current_period_start=dt.datetime(2026, 9, 1, tzinfo=dt.timezone.utc),
                current_period_end=dt.datetime(2026, 10, 1, tzinfo=dt.timezone.utc),
            )
        )
        db.commit()
        frozen = acceptance.receipt_snapshot_encrypted
    finally:
        db.close()
    return protocol, frozen


def _fee(Session) -> Decimal:
    db = Session()
    try:
        restaurant = db.query(Restaurante).filter(Restaurante.id == TENANT_ID).one()
        return OnlinePaymentService.marketplace_fee_for_tenant(
            db,
            Decimal("100.00"),
            restaurant,
        )
    finally:
        db.close()


def test_legacy_pro_to_premium_changes_split_only_after_provider_sync_and_atomic_apply(
    plan_change_env,
    monkeypatch,
):
    client, Session = plan_change_env
    old_protocol, frozen_old_receipt = _seed_legacy_pro(client, Session)

    provider_updates: list[tuple[str, Decimal, str]] = []
    monkeypatch.setattr(
        default_saas_mp_service,
        "get_preapproval",
        lambda _ref: {
            "id": "mock-pro-v25",
            "status": "authorized",
            "auto_recurring": {"transaction_amount": 209.0, "currency_id": "BRL"},
        },
    )
    monkeypatch.setattr(
        default_saas_mp_service,
        "update_preapproval_amount",
        lambda ref, *, amount, plan: (
            provider_updates.append((ref, Decimal(str(amount)), plan))
            or {
                "id": ref,
                "status": "authorized",
                "auto_recurring": {
                    "transaction_amount": float(amount),
                    "currency_id": "BRL",
                },
            }
        ),
    )

    assert _fee(Session) == Decimal("0.69")

    accepted = client.post(
        "/api/subscription/plan-change/accept",
        json=_payload("premium"),
    )
    assert accepted.status_code == 201, accepted.text
    body = accepted.json()
    assert body["sourceProtocol"] == old_protocol
    assert body["sourcePlan"] == "pro"
    assert body["targetPlan"] == "premium"
    assert body["providerAction"] == "update_amount"
    assert body["receipt"]["commercial"]["trialDays"] == 0
    assert body["receipt"]["commercial"]["marketplaceRate"] == "0.002000"
    assert body["receipt"]["change"]["fromMarketplaceRate"] == "0.006900"

    # Aceitar novos termos ainda não troca nem recursos nem split.
    assert _fee(Session) == Decimal("0.69")
    db = Session()
    try:
        restaurant = db.query(Restaurante).filter(Restaurante.id == TENANT_ID).one()
        assert restaurant.plano == "pro"
        terms = tenant_commercial_terms(db, TENANT_ID)
        assert terms is not None
        assert terms.protocol == old_protocol
        assert terms.marketplace_rate == Decimal("0.006900")
    finally:
        db.close()

    applied = client.post(
        f"/api/subscription/plan-change/{body['id']}/apply",
    )
    assert applied.status_code == 200, applied.text
    assert applied.json()["status"] == "applied"
    assert applied.json()["marketplaceRate"] == "0.002000"
    assert provider_updates == [("mock-pro-v25", Decimal("249.00"), "premium")]

    assert _fee(Session) == Decimal("0.20")
    db = Session()
    try:
        restaurant = db.query(Restaurante).filter(Restaurante.id == TENANT_ID).one()
        assert restaurant.plano == "premium"
        terms = tenant_commercial_terms(db, TENANT_ID)
        assert terms is not None
        assert terms.plan == "premium"
        assert terms.marketplace_rate == Decimal("0.002000")

        old = (
            db.query(ContractAcceptance)
            .filter(ContractAcceptance.protocol == old_protocol)
            .one()
        )
        assert old.receipt_snapshot_encrypted == frozen_old_receipt
        assert old.legal_version == "2.5"

        sub = db.query(SaaSSubscription).filter(SaaSSubscription.restaurante_id == TENANT_ID).one()
        assert sub.provider_subscription_id == "mock-pro-v25"
        assert sub.payment_method_type == "credit_card"
        assert sub.status == "active"
    finally:
        db.close()


def test_same_plan_legacy_pro_can_migrate_to_current_pro_terms(plan_change_env, monkeypatch):
    client, Session = plan_change_env
    _seed_legacy_pro(client, Session)

    monkeypatch.setattr(
        default_saas_mp_service,
        "get_preapproval",
        lambda _ref: {
            "status": "authorized",
            "auto_recurring": {"transaction_amount": 209.0},
        },
    )
    updated: list[Decimal] = []
    monkeypatch.setattr(
        default_saas_mp_service,
        "update_preapproval_amount",
        lambda _ref, *, amount, plan: (
            updated.append(Decimal(str(amount)))
            or {"status": "authorized", "auto_recurring": {"transaction_amount": float(amount)}}
        ),
    )

    accepted = client.post(
        "/api/subscription/plan-change/accept",
        json=_payload("pro"),
    )
    assert accepted.status_code == 201, accepted.text
    change = accepted.json()
    assert change["sourcePlan"] == "pro"
    assert change["targetPlan"] == "pro"
    assert change["providerAction"] == "update_amount"
    assert _fee(Session) == Decimal("0.69")

    applied = client.post(f"/api/subscription/plan-change/{change['id']}/apply")
    assert applied.status_code == 200, applied.text
    assert updated == [Decimal("129.00")]
    assert _fee(Session) == Decimal("0.50")


def test_paid_to_pocket_updates_recurrence_before_new_split_becomes_authority(
    plan_change_env,
    monkeypatch,
):
    client, Session = plan_change_env
    _seed_legacy_pro(client, Session)

    monkeypatch.setattr(
        default_saas_mp_service,
        "get_preapproval",
        lambda _ref: {"status": "authorized"},
    )
    updated: list[tuple[str, Decimal, str]] = []
    monkeypatch.setattr(
        default_saas_mp_service,
        "update_preapproval_amount",
        lambda ref, *, amount, plan: (
            updated.append((ref, Decimal(str(amount)), plan))
            or {"id": ref, "status": "authorized"}
        ),
    )

    accepted = client.post(
        "/api/subscription/plan-change/accept",
        json=_payload("pocket"),
    )
    assert accepted.status_code == 201, accepted.text
    change = accepted.json()
    assert change["providerAction"] == "update_amount"
    assert change["receipt"]["commercial"]["billingAmount"] == "39.90"
    assert change["receipt"]["commercial"]["trialDays"] == 0
    assert _fee(Session) == Decimal("0.69")

    applied = client.post(f"/api/subscription/plan-change/{change['id']}/apply")
    assert applied.status_code == 200, applied.text
    assert updated == [("mock-pro-v25", Decimal("39.90"), "pocket")]
    assert _fee(Session) == Decimal("1.79")

    db = Session()
    try:
        sub = db.query(SaaSSubscription).filter(SaaSSubscription.restaurante_id == TENANT_ID).one()
        assert sub.provider_subscription_id == "mock-pro-v25"
        assert sub.payment_method_type == "credit_card"
        assert sub.billing_cycle == "monthly"
        assert sub.status == "active"
    finally:
        db.close()


def test_pending_pix_blocks_plan_change_and_preserves_old_contract(plan_change_env, monkeypatch):
    client, Session = plan_change_env
    _seed_legacy_pro(
        client,
        Session,
        payment_method="pix",
        provider_ref="pix-old-pending",
    )
    monkeypatch.setattr(
        default_saas_mp_service,
        "get_payment",
        lambda _ref: {
            "id": "pix-old-pending",
            "status": "pending",
            "date_of_expiration": (
                dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=6)
            ).isoformat(),
        },
    )

    accepted = client.post(
        "/api/subscription/plan-change/accept",
        json=_payload("premium"),
    )
    assert accepted.status_code == 201, accepted.text
    change = accepted.json()
    assert change["providerAction"] == "verify_pix"

    applied = client.post(f"/api/subscription/plan-change/{change['id']}/apply")
    assert applied.status_code == 409
    assert "Pix pendente" in applied.text
    assert _fee(Session) == Decimal("0.69")

    db = Session()
    try:
        restaurant = db.query(Restaurante).filter(Restaurante.id == TENANT_ID).one()
        assert restaurant.plano == "pro"
        stored = db.query(SaaSPlanChange).filter(SaaSPlanChange.id == change["id"]).one()
        assert stored.status == "pending"
        assert stored.last_error_code == "pending_pix_invoice"
    finally:
        db.close()


def test_approved_pix_waiting_for_reconciliation_blocks_plan_change(
    plan_change_env,
    monkeypatch,
):
    client, Session = plan_change_env
    _seed_legacy_pro(
        client,
        Session,
        payment_method="pix",
        provider_ref="pix-old-approved",
    )
    approved_at = dt.datetime(2026, 9, 20, 12, 0, tzinfo=dt.timezone.utc)
    monkeypatch.setattr(
        default_saas_mp_service,
        "get_payment",
        lambda _ref: {
            "id": "pix-old-approved",
            "status": "approved",
            "date_approved": approved_at.isoformat(),
            "date_of_expiration": (
                approved_at + dt.timedelta(hours=1)
            ).isoformat(),
        },
    )

    accepted = client.post(
        "/api/subscription/plan-change/accept",
        json=_payload("premium"),
    )
    assert accepted.status_code == 201, accepted.text

    applied = client.post(
        f"/api/subscription/plan-change/{accepted.json()['id']}/apply",
    )
    assert applied.status_code == 409
    assert "aguardando reconciliação" in applied.text
    assert _fee(Session) == Decimal("0.69")

    db = Session()
    try:
        restaurant = db.query(Restaurante).filter(Restaurante.id == TENANT_ID).one()
        assert restaurant.plano == "pro"
    finally:
        db.close()


def test_plan_change_acceptance_is_not_exposed_as_new_tenant_activation(plan_change_env):
    client, Session = plan_change_env
    _seed_legacy_pro(client, Session)

    accepted = client.post(
        "/api/subscription/plan-change/accept",
        json=_payload("premium"),
    )
    assert accepted.status_code == 201, accepted.text
    protocol = accepted.json()["protocol"]

    inbox = client.get("/api/super-admin/contracts?status=all")
    assert inbox.status_code == 200, inbox.text
    item = next(
        row for row in inbox.json()["items"]
        if row["protocol"] == protocol
    )
    assert item["status"] == "PLAN_CHANGE_PENDING"
    assert item["contractPurpose"] == "plan_change"
    assert item["planChangeRestaurantId"] == str(TENANT_ID)
    assert item["activationEligible"] is False

    preview = client.get(f"/api/super-admin/contracts/preview/{protocol}")
    assert preview.status_code == 200, preview.text
    assert preview.json()["contractPurpose"] == "plan_change"
    assert preview.json()["activationEligible"] is False

    activation = client.post(
        f"/api/super-admin/contracts/{protocol}/activate",
        json={"reason": "Não deve provisionar um novo tenant"},
    )
    assert activation.status_code == 409
    assert "não pode provisionar um novo restaurante" in activation.text
    assert _fee(Session) == Decimal("0.69")


def test_fee_flag_false_still_forces_zero_after_plan_change(plan_change_env, monkeypatch):
    client, Session = plan_change_env
    _seed_legacy_pro(client, Session)
    monkeypatch.setattr(
        default_saas_mp_service,
        "get_preapproval",
        lambda _ref: {"status": "authorized", "auto_recurring": {"transaction_amount": 209.0}},
    )
    monkeypatch.setattr(
        default_saas_mp_service,
        "update_preapproval_amount",
        lambda ref, *, amount, plan: {"id": ref, "status": "authorized"},
    )

    accepted = client.post(
        "/api/subscription/plan-change/accept",
        json=_payload("premium"),
    ).json()
    response = client.post(f"/api/subscription/plan-change/{accepted['id']}/apply")
    assert response.status_code == 200, response.text

    monkeypatch.setattr(settings, "ONLINE_PAYMENT_PLAN_FEES_ENABLED", False)
    assert _fee(Session) == Decimal("0.00")


def test_plan_change_acceptance_cannot_enter_initial_billing_checkout(
    plan_change_env,
    monkeypatch,
):
    client, Session = plan_change_env
    _seed_legacy_pro(client, Session)

    accepted = client.post(
        "/api/subscription/plan-change/accept",
        json=_payload("premium"),
    )
    assert accepted.status_code == 201, accepted.text
    protocol = accepted.json()["protocol"]

    db = Session()
    try:
        resolved = resolve_activation_acceptance(db, protocol)
        assert resolved is not None
        assert resolved["plan_change_restaurante_id"] == TENANT_ID
    finally:
        db.close()

    monkeypatch.setattr(
        saas_billing.default_saas_mp_service,
        "checkout_capabilities",
        lambda: {"credit_card": True},
    )
    setup = client.post(
        f"/api/contracts/{protocol}/billing/setup",
        json={
            "payment_method_type": "credit_card",
            "card_token_id": "must-not-reach-provider",
            "payer_email": "admin-migracao@koma.test",
        },
    )
    assert setup.status_code == 409
    assert "mudança de plano" in setup.text

    db = Session()
    try:
        assert saas_billing.get_billing_setup(db, protocol) is None
    finally:
        db.close()


def test_plan_change_to_pocket_cannot_use_initial_free_activation(plan_change_env):
    client, Session = plan_change_env
    _seed_legacy_pro(client, Session)

    accepted = client.post(
        "/api/subscription/plan-change/accept",
        json=_payload("pocket"),
    )
    assert accepted.status_code == 201, accepted.text
    protocol = accepted.json()["protocol"]

    activation = client.post(
        f"/api/contracts/{protocol}/billing/activate-free",
    )
    assert activation.status_code == 409
    assert "mudança de plano" in activation.text

    db = Session()
    try:
        restaurants = db.query(Restaurante).all()
        assert [row.id for row in restaurants] == [TENANT_ID]
    finally:
        db.close()


def test_superadmin_cannot_replace_existing_contract_authority_by_manual_link(plan_change_env):
    client, Session = plan_change_env
    _seed_legacy_pro(client, Session)

    replacement = client.post("/api/contracts/accept", json=_payload("pro"))
    assert replacement.status_code == 201, replacement.text

    response = client.post(
        "/api/super-admin/contracts/link",
        json={
            "restaurant_id": TENANT_ID,
            "protocol": replacement.json()["protocol"],
            "reason": "Tentativa de substituir termos manualmente",
        },
    )
    assert response.status_code == 409
    assert "fluxo canônico" in response.text

    assert _fee(Session) == Decimal("0.69")


def test_superadmin_cannot_manually_link_acceptance_owned_by_plan_change(plan_change_env):
    client, Session = plan_change_env
    _seed_legacy_pro(client, Session)

    accepted = client.post(
        "/api/subscription/plan-change/accept",
        json=_payload("premium"),
    )
    assert accepted.status_code == 201, accepted.text

    response = client.post(
        "/api/super-admin/contracts/link",
        json={
            "restaurant_id": TENANT_ID,
            "protocol": accepted.json()["protocol"],
            "reason": "Tentativa de furar state machine",
        },
    )
    assert response.status_code == 409
    assert "mudança comercial canônica" in response.text
    assert _fee(Session) == Decimal("0.69")
