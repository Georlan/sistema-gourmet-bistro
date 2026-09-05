from __future__ import annotations

import json
import uuid
from decimal import Decimal

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.contract_models import ContractAcceptance
from app.contract_validation import is_valid_cnpj, is_valid_cpf, tax_id_kind
from app.crypt import decrypt_field
from app.legal_config import LEGAL_SOURCE_BLOB_SHA, LEGAL_SOURCE_COMMIT, LEGAL_VERSION
from app.routes import contracts
from app.subscription import (
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


def _payload(*, tax_id: str = VALID_CNPJ, representative_tax_id: str = VALID_CPF, billing_cycle: str = "anual") -> dict:
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
        "plan": "pocket",
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
    TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    monkeypatch.setattr(contracts, "SessionLocal", TestingSessionLocal)

    monkeypatch.setenv("KOMA_LEGAL_PROVIDER_NAME", "Prestador de Teste")
    monkeypatch.setenv("KOMA_LEGAL_PROVIDER_TAX_ID", VALID_CPF)
    monkeypatch.setenv("KOMA_LEGAL_PROVIDER_ADDRESS", "Endereço jurídico de teste, 100")
    monkeypatch.setenv("KOMA_LEGAL_PROVIDER_LOCATION", "Limoeiro do Norte/CE")

    app = FastAPI()
    app.include_router(contracts.router)
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
    assert subscription_monthly_price("pocket") == Decimal("109.00")
    assert subscription_marketplace_rate("pocket") == Decimal("0.0149")
    assert subscription_annual_total("pocket") == Decimal("1177.20")
    assert subscription_annual_monthly_equivalent("pocket") == Decimal("98.10")


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
    assert receipt["commercial"]["fixedMonthlyPrice"] == "109.00"
    assert receipt["commercial"]["billingAmount"] == "1177.20"
    assert receipt["commercial"]["annualMonthlyEquivalent"] == "98.10"
    assert receipt["commercial"]["marketplaceRate"] == "0.014900"
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
