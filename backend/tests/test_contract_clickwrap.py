from __future__ import annotations

import datetime as dt
import json
import uuid
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.contract_models import ContractAcceptance, RestaurantContractAcceptance
from app.contract_validation import is_valid_cnpj, is_valid_cpf, tax_id_kind
from app.crypt import decrypt_field, encrypt_field
from app.config import settings
from app.database import current_restaurante_id
from app.legal_config import LEGAL_SOURCE_BLOB_SHA, LEGAL_SOURCE_COMMIT, LEGAL_VERSION
from app.routes import contracts, super_admin_contracts
from app.services.billing_service import tenant_commercial_terms
from app.services.online_payments.service import OnlinePaymentService
from app.subscription import (
    COMMERCIAL_PRICING_VERSION,
    subscription_annual_monthly_equivalent,
    subscription_annual_total,
    subscription_marketplace_rate,
    subscription_monthly_price,
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


def _payload(*, tax_id: str = VALID_CNPJ, representative_tax_id: str = VALID_CPF, plan: str = "pocket", billing_cycle: str = "mensal") -> dict:
    return {
        "request_id": str(uuid.uuid4()),
        "contracting_party_name": "Restaurante Teste Ltda",
        "contracting_party_tax_id": tax_id,
        "restaurant_name": "Restaurante Teste",
        "representative_name": "Responsável Teste",
        "representative_tax_id": representative_tax_id,
        "representative_role": "Sócio administrador",
        "email": "contratos@example.com",
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
    ContractAcceptance.__table__.create(engine)
    from app.signup_models import SignupBase
    SignupBase.metadata.create_all(engine)
    RestaurantContractAcceptance.__table__.create(engine)
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
        "user": "contract-test-superadmin"
    }
    with TestClient(app) as client:
        yield client, TestingSessionLocal
    engine.dispose()


def test_cpf_cnpj_validation_rejects_repeated_digits_and_accepts_valid_examples():
    assert is_valid_cpf(VALID_CPF)
    assert tax_id_kind(VALID_CPF) == "cpf"
    assert not is_valid_cpf("00000000000")
    assert not is_valid_cpf("11111111111")

    assert is_valid_cnpj(VALID_CNPJ)
    assert tax_id_kind(VALID_CNPJ) == "cnpj"
    assert not is_valid_cnpj("00000000000000")
    assert not is_valid_cnpj("11111111111111")


def test_server_is_source_of_truth_for_contract_prices():
    assert subscription_monthly_price("pocket") == Decimal("39.90")
    assert subscription_marketplace_rate("pocket") == Decimal("0.0179")
    # O Pocket continua disponível apenas no ciclo mensal.

    assert subscription_monthly_price("pro") == Decimal("129.00")
    assert subscription_marketplace_rate("pro") == Decimal("0.0050")
    assert subscription_annual_total("pro") == Decimal("1393.20")
    assert subscription_annual_monthly_equivalent("pro") == Decimal("116.10")

    assert subscription_monthly_price("premium") == Decimal("249.00")
    assert subscription_marketplace_rate("premium") == Decimal("0.0020")
    assert subscription_annual_total("premium") == Decimal("2689.20")
    assert subscription_annual_monthly_equivalent("premium") == Decimal("224.10")


def test_accept_persists_immutable_snapshot_and_returns_receipt(client_and_session):
    client, Session = client_and_session
    response = client.post(
        "/api/contracts/accept",
        json=_payload(),
        headers={
            "cf-connecting-ip": "203.0.113.25",
            "user-agent": "KomaContractTest/1.0",
        },
    )
    assert response.status_code == 201, response.text
    data = response.json()
    assert data["protocol"].startswith("KOMA-CTR-")
    receipt = data["receipt"]
    assert receipt["commercial"]["pricingVersion"] == COMMERCIAL_PRICING_VERSION
    assert receipt["commercial"]["fixedMonthlyPrice"] == "39.90"
    assert receipt["commercial"]["billingAmount"] == "39.90"
    assert receipt["commercial"]["annualMonthlyEquivalent"] is None
    assert receipt["commercial"]["marketplaceRate"] == "0.017900"
    assert receipt["commercial"]["fixedBillingRequired"] is True
    assert receipt["commercial"]["trialDays"] == 7
    assert receipt["commercial"]["trialWaivesFixedFeeOnly"] is True
    assert receipt["documents"]["sourceCommit"] == LEGAL_SOURCE_COMMIT
    assert receipt["documents"]["sourceBlobSha"] == LEGAL_SOURCE_BLOB_SHA
    assert receipt["evidence"]["sourceIp"] == "203.0.113.25"
    assert len(receipt["documents"]["terms"]["hash"]) == 64

    db = Session()
    try:
        row = db.execute(select(ContractAcceptance)).scalar_one()
        assert row.protocol == data["protocol"]
        assert row.contracting_party_tax_id_encrypted != VALID_CNPJ
        assert decrypt_field(row.contracting_party_tax_id_encrypted) == VALID_CNPJ
        assert row.contracting_party_tax_id_last4 == VALID_CNPJ[-4:]
        assert row.representative_tax_id_encrypted != VALID_CPF
        assert decrypt_field(row.representative_tax_id_encrypted) == VALID_CPF
        assert row.source_ip_encrypted != "203.0.113.25"
        assert decrypt_field(row.source_ip_encrypted) == "203.0.113.25"
        assert row.terms_hash == receipt["documents"]["terms"]["hash"]
        assert json.loads(decrypt_field(row.receipt_snapshot_encrypted))["protocol"] == data["protocol"]
    finally:
        db.close()


def test_paid_annual_contract_snapshots_discounted_fixed_amount_only(client_and_session):
    client, _Session = client_and_session

    pro = client.post(
        "/api/contracts/accept",
        json=_payload(plan="pro", billing_cycle="anual"),
    )
    assert pro.status_code == 201, pro.text
    pro_receipt = pro.json()["receipt"]["commercial"]
    assert pro_receipt["fixedMonthlyPrice"] == "129.00"
    assert pro_receipt["billingAmount"] == "1393.20"
    assert pro_receipt["annualMonthlyEquivalent"] == "116.10"
    assert pro_receipt["marketplaceRate"] == "0.005000"
    assert pro_receipt["trialDays"] == 7

    premium = client.post(
        "/api/contracts/accept",
        json=_payload(plan="premium", billing_cycle="anual"),
    )
    assert premium.status_code == 201, premium.text
    premium_receipt = premium.json()["receipt"]["commercial"]
    assert premium_receipt["fixedMonthlyPrice"] == "249.00"
    assert premium_receipt["billingAmount"] == "2689.20"
    assert premium_receipt["annualMonthlyEquivalent"] == "224.10"
    assert premium_receipt["marketplaceRate"] == "0.002000"


def test_pocket_rejects_meaningless_annual_fixed_cycle(client_and_session):
    client, _Session = client_and_session
    response = client.post(
        "/api/contracts/accept",
        json=_payload(plan="pocket", billing_cycle="anual"),
    )
    assert response.status_code == 422
    assert "apenas no ciclo mensal" in response.json()["detail"]


def test_tenant_commercial_terms_resolves_linked_signed_receipt(client_and_session):
    client, Session = client_and_session
    accepted = client.post(
        "/api/contracts/accept",
        json=_payload(billing_cycle="mensal"),
    )
    assert accepted.status_code == 201, accepted.text

    db = Session()
    try:
        acceptance = db.execute(select(ContractAcceptance)).scalar_one()
        db.add(
            RestaurantContractAcceptance(
                id=str(uuid.uuid4()),
                restaurante_id=987,
                acceptance_id=acceptance.id,
            )
        )
        db.commit()

        terms = tenant_commercial_terms(db, 987)
        assert terms is not None
        assert terms.protocol == accepted.json()["protocol"]
        assert terms.plan == "pocket"
        assert terms.billing_cycle == "mensal"
        assert terms.fixed_monthly_price == Decimal("39.90")
        assert terms.billing_amount == Decimal("39.90")
        assert terms.annual_monthly_equivalent is None
        assert terms.marketplace_rate == Decimal("0.017900")
        assert terms.legal_version == LEGAL_VERSION
        assert terms.pricing_version == COMMERCIAL_PRICING_VERSION
    finally:
        db.close()


def test_legacy_v25_snapshot_remains_authoritative_and_immutable(client_and_session):
    client, Session = client_and_session
    accepted = client.post(
        "/api/contracts/accept",
        json=_payload(plan="pocket", billing_cycle="mensal"),
    )
    assert accepted.status_code == 201, accepted.text

    db = Session()
    try:
        acceptance = db.execute(select(ContractAcceptance)).scalar_one()
        legacy_receipt = json.loads(decrypt_field(acceptance.receipt_snapshot_encrypted))
        legacy_receipt["commercial"].pop("pricingVersion", None)
        legacy_receipt["commercial"]["fixedMonthlyPrice"] = "109.00"
        legacy_receipt["commercial"]["billingAmount"] = "109.00"
        legacy_receipt["commercial"]["annualMonthlyEquivalent"] = None
        legacy_receipt["commercial"]["marketplaceRate"] = "0.014900"
        legacy_receipt["commercial"]["fixedBillingRequired"] = True
        legacy_receipt["commercial"]["trialDays"] = 7
        legacy_receipt["commercial"]["trialWaivesFixedFeeOnly"] = True
        legacy_receipt["documents"]["version"] = "2.5"

        legacy_snapshot = json.dumps(
            legacy_receipt,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        acceptance.fixed_monthly_price = Decimal("109.00")
        acceptance.billing_amount = Decimal("109.00")
        acceptance.annual_monthly_equivalent = None
        acceptance.marketplace_rate = Decimal("0.0149")
        acceptance.legal_version = "2.5"
        acceptance.receipt_snapshot_encrypted = encrypt_field(legacy_snapshot)
        db.add(
            RestaurantContractAcceptance(
                id=str(uuid.uuid4()),
                restaurante_id=988,
                acceptance_id=acceptance.id,
            )
        )
        db.commit()
        frozen_ciphertext = acceptance.receipt_snapshot_encrypted

        # Catálogo atual já é o vNext; o contrato antigo não acompanha a mudança.
        assert subscription_monthly_price("pocket") == Decimal("39.90")
        assert subscription_marketplace_rate("pocket") == Decimal("0.0179")

        terms = tenant_commercial_terms(db, 988)
        assert terms is not None
        assert terms.plan == "pocket"
        assert terms.fixed_monthly_price == Decimal("109.00")
        assert terms.billing_amount == Decimal("109.00")
        assert terms.marketplace_rate == Decimal("0.014900")
        assert terms.legal_version == "2.5"
        assert terms.pricing_version is None

        db.refresh(acceptance)
        assert acceptance.receipt_snapshot_encrypted == frozen_ciphertext
        assert json.loads(decrypt_field(acceptance.receipt_snapshot_encrypted)) == legacy_receipt
    finally:
        db.close()


def test_latest_linked_acceptance_switches_future_split_without_rewriting_history(
    client_and_session,
    monkeypatch,
):
    client, Session = client_and_session
    old_response = client.post(
        "/api/contracts/accept",
        json=_payload(plan="pro", billing_cycle="mensal"),
    )
    new_response = client.post(
        "/api/contracts/accept",
        json=_payload(plan="premium", billing_cycle="mensal"),
    )
    assert old_response.status_code == 201, old_response.text
    assert new_response.status_code == 201, new_response.text

    monkeypatch.setattr(settings, "ONLINE_PAYMENT_PLAN_FEES_ENABLED", True)
    db = Session()
    try:
        old_acceptance = (
            db.query(ContractAcceptance)
            .filter(ContractAcceptance.protocol == old_response.json()["protocol"])
            .one()
        )
        new_acceptance = (
            db.query(ContractAcceptance)
            .filter(ContractAcceptance.protocol == new_response.json()["protocol"])
            .one()
        )

        old_receipt = json.loads(
            decrypt_field(old_acceptance.receipt_snapshot_encrypted)
        )
        old_receipt["commercial"].pop("pricingVersion", None)
        old_receipt["commercial"]["fixedMonthlyPrice"] = "209.00"
        old_receipt["commercial"]["billingAmount"] = "209.00"
        old_receipt["commercial"]["annualMonthlyEquivalent"] = None
        old_receipt["commercial"]["marketplaceRate"] = "0.006900"
        old_receipt["documents"]["version"] = "2.5"
        old_snapshot = json.dumps(
            old_receipt,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        old_acceptance.receipt_snapshot_encrypted = encrypt_field(old_snapshot)
        old_acceptance.fixed_monthly_price = Decimal("209.00")
        old_acceptance.billing_amount = Decimal("209.00")
        old_acceptance.marketplace_rate = Decimal("0.0069")
        old_acceptance.legal_version = "2.5"

        base_time = dt.datetime(2026, 9, 18, 12, 0, tzinfo=dt.timezone.utc)
        db.add(
            RestaurantContractAcceptance(
                id="00000000-0000-0000-0000-000000000001",
                restaurante_id=991,
                acceptance_id=old_acceptance.id,
                linked_at=base_time,
            )
        )
        db.commit()
        frozen_old_ciphertext = old_acceptance.receipt_snapshot_encrypted

        # O slug de recursos já pode até dizer Premium: dinheiro continua Pro 2.5
        # enquanto o novo aceite ainda não virou autoridade.
        restaurant = SimpleNamespace(
            id=991,
            plano="premium",
            billing_mode="subscription",
        )
        assert OnlinePaymentService.marketplace_fee_for_tenant(
            db,
            Decimal("100.00"),
            restaurant,
        ) == Decimal("0.69")

        # A mudança financeira só acontece quando o novo aceite é vinculado.
        db.add(
            RestaurantContractAcceptance(
                id="00000000-0000-0000-0000-000000000002",
                restaurante_id=991,
                acceptance_id=new_acceptance.id,
                linked_at=base_time + dt.timedelta(seconds=1),
            )
        )
        db.commit()

        terms = tenant_commercial_terms(db, 991)
        assert terms is not None
        assert terms.protocol == new_response.json()["protocol"]
        assert terms.plan == "premium"
        assert terms.marketplace_rate == Decimal("0.002000")
        assert terms.pricing_version == COMMERCIAL_PRICING_VERSION
        assert OnlinePaymentService.marketplace_fee_for_tenant(
            db,
            Decimal("100.00"),
            restaurant,
        ) == Decimal("0.20")

        # O histórico contratual anterior permanece imutável.
        db.refresh(old_acceptance)
        assert old_acceptance.receipt_snapshot_encrypted == frozen_old_ciphertext
        assert (
            json.loads(decrypt_field(old_acceptance.receipt_snapshot_encrypted))
            ["commercial"]["marketplaceRate"]
            == "0.006900"
        )
        assert old_acceptance.legal_version == "2.5"
    finally:
        db.close()


def test_current_contract_returns_verified_accepted_document_snapshots(client_and_session):
    client, Session = client_and_session
    accepted = client.post(
        "/api/contracts/accept",
        json=_payload(plan="pro", billing_cycle="mensal"),
    )
    assert accepted.status_code == 201, accepted.text

    db = Session()
    token = current_restaurante_id.set(989)
    try:
        acceptance = db.execute(select(ContractAcceptance)).scalar_one()
        db.add(
            RestaurantContractAcceptance(
                id=str(uuid.uuid4()),
                restaurante_id=989,
                acceptance_id=acceptance.id,
            )
        )
        db.commit()

        result = contracts.get_current_contract(
            db=db,
            current_user=SimpleNamespace(cargo="admin"),
        )
        assert result["tenantId"] == 989
        assert result["receipt"]["protocol"] == accepted.json()["protocol"]
        assert result["acceptedDocuments"] == _documents()
        assert result["acceptedDocuments"]["commercial"]["version"] == LEGAL_VERSION
    finally:
        current_restaurante_id.reset(token)
        db.close()


def test_current_contract_fails_closed_when_accepted_snapshot_hash_diverges(client_and_session):
    client, Session = client_and_session
    accepted = client.post(
        "/api/contracts/accept",
        json=_payload(plan="pro", billing_cycle="mensal"),
    )
    assert accepted.status_code == 201, accepted.text

    db = Session()
    token = current_restaurante_id.set(990)
    try:
        acceptance = db.execute(select(ContractAcceptance)).scalar_one()
        db.add(
            RestaurantContractAcceptance(
                id=str(uuid.uuid4()),
                restaurante_id=990,
                acceptance_id=acceptance.id,
            )
        )
        acceptance.terms_snapshot = json.dumps(
            {
                "slug": "termos",
                "title": "Texto adulterado",
                "version": LEGAL_VERSION,
                "sections": [],
            },
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        db.commit()

        with pytest.raises(HTTPException) as exc_info:
            contracts.get_current_contract(
                db=db,
                current_user=SimpleNamespace(cargo="admin"),
            )
        assert exc_info.value.status_code == 409
        assert "Integridade do snapshot jurídico inválida: terms" in str(
            exc_info.value.detail
        )
    finally:
        current_restaurante_id.reset(token)
        db.close()


def test_superadmin_inbox_lists_pending_acceptance_without_exposing_full_tax_ids(client_and_session):
    client, Session = client_and_session
    accepted = client.post(
        "/api/contracts/accept",
        json=_payload(billing_cycle="mensal"),
    )
    assert accepted.status_code == 201, accepted.text
    protocol = accepted.json()["protocol"]

    response = client.get("/api/super-admin/contracts?status=all")
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["pendingCount"] == 1
    assert data["total"] == 1
    assert data["returned"] == 1
    item = data["items"][0]
    assert item["protocol"] == protocol
    assert item["status"] == "SIGNED_PENDING_ACTIVATION"
    assert item["plan"] == "pocket"
    assert item["billingCycle"] == "mensal"
    assert item["fixedMonthlyPrice"] == "39.90"
    assert item["billingAmount"] == "39.90"
    assert item["billingStatus"] == "pending"
    assert item["activationEligible"] is True
    assert item["contractingPartyTaxIdLast4"] == VALID_CNPJ[-4:]
    assert item["representativeTaxIdLast4"] == VALID_CPF[-4:]
    serialized = json.dumps(item)
    assert VALID_CNPJ not in serialized
    assert VALID_CPF not in serialized

    db = Session()
    try:
        acceptance = db.execute(select(ContractAcceptance)).scalar_one()
        db.add(
            RestaurantContractAcceptance(
                id=str(uuid.uuid4()),
                restaurante_id=987,
                acceptance_id=acceptance.id,
            )
        )
        db.commit()
    finally:
        db.close()

    activated = client.get("/api/super-admin/contracts?status=activated")
    assert activated.status_code == 200, activated.text
    activated_data = activated.json()
    assert activated_data["pendingCount"] == 0
    assert activated_data["returned"] == 1
    activated_item = activated_data["items"][0]
    assert activated_item["status"] == "ACTIVATED"
    assert activated_item["linkedRestaurantId"] == "987"


def test_superadmin_inbox_rejects_unknown_status_filter(client_and_session):
    client, _ = client_and_session
    response = client.get("/api/super-admin/contracts?status=magic")
    assert response.status_code == 422
    assert "pending" in response.json()["detail"]


def test_accept_rejects_invalid_tax_ids(client_and_session):
    client, _ = client_and_session
    invalid_party = client.post("/api/contracts/accept", json=_payload(tax_id="11111111111111"))
    assert invalid_party.status_code == 422
    assert invalid_party.json()["detail"] == "CPF/CNPJ do contratante inválido."

    invalid_representative = client.post(
        "/api/contracts/accept",
        json=_payload(representative_tax_id="00000000000"),
    )
    assert invalid_representative.status_code == 422
    assert invalid_representative.json()["detail"] == "CPF do representante inválido."


def test_accept_fails_closed_when_provider_identity_is_not_configured(client_and_session, monkeypatch):
    client, _ = client_and_session
    monkeypatch.delenv("KOMA_LEGAL_PROVIDER_TAX_ID", raising=False)
    response = client.post("/api/contracts/accept", json=_payload())
    assert response.status_code == 503
    assert "identificação jurídica" in response.json()["detail"].lower()


def test_accept_rejects_stale_legal_provenance(client_and_session):
    client, _ = client_and_session
    payload = _payload()
    payload["legal_source_blob_sha"] = "0" * 40
    response = client.post("/api/contracts/accept", json=payload)
    assert response.status_code == 409
    assert "origem dos documentos" in response.json()["detail"].lower()
