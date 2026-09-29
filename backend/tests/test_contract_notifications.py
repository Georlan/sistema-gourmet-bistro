from __future__ import annotations

import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import settings
from app.contract_models import ContractAcceptance
from app.legal_config import LEGAL_SOURCE_BLOB_SHA, LEGAL_SOURCE_COMMIT, LEGAL_VERSION
from app.routes import contracts


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


def _payload() -> dict:
    return {
        "request_id": str(uuid.uuid4()),
        "contracting_party_name": "Restaurante Notificação Ltda",
        "contracting_party_tax_id": VALID_CNPJ,
        "restaurant_name": "Restaurante Notificação",
        "representative_name": "Responsável Notificação",
        "representative_tax_id": VALID_CPF,
        "representative_role": "Sócio administrador",
        "email": "notificacao@example.com",
        "phone": "85999999999",
        "plan": "pocket",
        "billing_cycle": "mensal",
        "powers_declared": True,
        "legal_version": LEGAL_VERSION,
        "legal_source_commit": LEGAL_SOURCE_COMMIT,
        "legal_source_blob_sha": LEGAL_SOURCE_BLOB_SHA,
        "documents": _documents(),
    }


@pytest.fixture()
def contract_client(monkeypatch):
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    ContractAcceptance.__table__.create(engine)
    from app.signup_models import SignupBase
    SignupBase.metadata.create_all(engine)
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


def test_acceptance_queues_notifications_atomically(contract_client, monkeypatch):
    from app.signup_models import SignupNotification
    client, Session = contract_client
    payload = _payload()
    response = client.post("/api/contracts/accept", json=payload)
    assert response.status_code == 201, response.text
    with Session() as db:
        rows = db.query(SignupNotification).all()
        assert len(rows) == 1
        assert rows[0].id.endswith(":email")
        assert all(row.status == "pending" for row in rows)
        assert all(payload["phone"] not in row.payload_encrypted for row in rows)
        count = len(rows)
    duplicate = client.post("/api/contracts/accept", json=payload)
    assert duplicate.status_code == 409
    with Session() as db:
        assert db.query(SignupNotification).count() == count
