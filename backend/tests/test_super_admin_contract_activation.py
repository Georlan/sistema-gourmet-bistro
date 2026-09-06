from __future__ import annotations

import json
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.contract_models import ContractAcceptance, RestaurantContractAcceptance
from app.database import Base
from app.legal_config import LEGAL_SOURCE_BLOB_SHA, LEGAL_SOURCE_COMMIT, LEGAL_VERSION
from app.models import ConfiguracaoRestaurante, Restaurante, SuperAdminAuditLog, Usuario
from app.routes import contracts, super_admin_contracts
from app.routes.super_admin_onboarding import restaurant_trials


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


def _contract_payload() -> dict:
    return {
        "request_id": str(uuid.uuid4()),
        "contracting_party_name": "Restaurante Ativação Ltda",
        "contracting_party_tax_id": VALID_CNPJ,
        "restaurant_name": "Bistrô Ativação",
        "representative_name": "Responsável Ativação",
        "representative_tax_id": VALID_CPF,
        "representative_role": "Sócio administrador",
        "email": "ativacao@example.com",
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
        "user": "activation-test-superadmin"
    }

    with TestClient(app) as client:
        yield client, TestingSessionLocal
    engine.dispose()


def _accept_contract(client: TestClient) -> str:
    accepted = client.post("/api/contracts/accept", json=_contract_payload())
    assert accepted.status_code == 201, accepted.text
    return accepted.json()["protocol"]


def test_one_click_activation_is_atomic_secure_and_idempotent(client_and_session):
    client, Session = client_and_session
    protocol = _accept_contract(client)

    activated = client.post(
        f"/api/super-admin/contracts/{protocol}/activate",
        json={"reason": "Ativação operacional do aceite eletrônico"},
    )
    assert activated.status_code == 200, activated.text
    body = activated.json()
    assert body["protocol"] == protocol
    assert body["plan"] == "pocket"
    assert body["billingCycle"] == "mensal"
    assert body["idempotent"] is False
    assert body["credentialDelivery"] == "pending_notification"
    assert body["admin"]["status"] == "pendente_ativacao"
    assert body["trial"]["daysGranted"] == 7
    assert body["subdomain"].endswith(protocol[-12:].lower())

    serialized = json.dumps(body).lower()
    assert "password" not in serialized
    assert "senha" not in serialized
    assert "access_token" not in serialized

    tenant_id = int(body["restaurantId"])
    db = Session()
    try:
        restaurant = db.execute(select(Restaurante)).scalar_one()
        assert restaurant.id == tenant_id
        assert restaurant.nome == "Bistrô Ativação"
        assert restaurant.plano == "pocket"
        assert restaurant.saas_status == "active"

        admin_user = db.execute(select(Usuario)).scalar_one()
        assert admin_user.restaurante_id == tenant_id
        assert admin_user.cargo == "admin"
        assert admin_user.status == "pendente_ativacao"
        assert admin_user.senha_hash is None

        trial = db.execute(select(restaurant_trials)).mappings().one()
        assert trial["restaurante_id"] == tenant_id
        assert trial["trial_status"] == "active"

        link = db.execute(select(RestaurantContractAcceptance)).scalar_one()
        assert link.restaurante_id == tenant_id

        audit = db.execute(select(SuperAdminAuditLog)).scalar_one()
        assert audit.action == "SUPERADMIN_CONTRACT_ACTIVATE"
        assert audit.restaurante_id == tenant_id
    finally:
        db.close()

    repeated = client.post(
        f"/api/super-admin/contracts/{protocol}/activate",
        json={"reason": "Repetição segura da ativação"},
    )
    assert repeated.status_code == 200, repeated.text
    repeated_body = repeated.json()
    assert repeated_body["idempotent"] is True
    assert repeated_body["restaurantId"] == str(tenant_id)

    db = Session()
    try:
        assert len(db.execute(select(Restaurante)).scalars().all()) == 1
        assert len(db.execute(select(Usuario)).scalars().all()) == 1
        assert len(db.execute(select(RestaurantContractAcceptance)).scalars().all()) == 1
        assert len(db.execute(select(SuperAdminAuditLog)).scalars().all()) == 1
    finally:
        db.close()


def test_activation_conflict_keeps_tenant_state_empty(client_and_session, monkeypatch):
    client, Session = client_and_session
    protocol = _accept_contract(client)
    monkeypatch.setattr(super_admin_contracts, "_slug_owner_id", lambda db, slug: 999)

    response = client.post(
        f"/api/super-admin/contracts/{protocol}/activate",
        json={"reason": "Teste de rollback atômico"},
    )
    assert response.status_code == 409, response.text

    db = Session()
    try:
        assert db.execute(select(Restaurante)).scalars().all() == []
        assert db.execute(select(Usuario)).scalars().all() == []
        assert db.execute(select(RestaurantContractAcceptance)).scalars().all() == []
        assert db.execute(select(SuperAdminAuditLog)).scalars().all() == []
    finally:
        db.close()
