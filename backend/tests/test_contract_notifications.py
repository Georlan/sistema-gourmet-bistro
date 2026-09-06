from __future__ import annotations

import logging
import uuid
from types import SimpleNamespace

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
from app.services import contract_notifications


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


def test_acceptance_schedules_notifications_only_after_persistence(contract_client, monkeypatch):
    client, Session = contract_client
    calls: list[dict] = []

    def capture(background_tasks, **kwargs):
        db = Session()
        try:
            assert db.execute(select(ContractAcceptance)).scalar_one_or_none() is not None
        finally:
            db.close()
        calls.append(kwargs)

    monkeypatch.setattr(contracts, "schedule_contract_accepted_notifications", capture)
    payload = _payload()

    response = client.post("/api/contracts/accept", json=payload)
    assert response.status_code == 201, response.text
    protocol = response.json()["protocol"]
    assert len(calls) == 1
    assert calls[0]["protocol"] == protocol
    assert calls[0]["restaurant_name"] == "Restaurante Notificação"
    assert calls[0]["representative_name"] == "Responsável Notificação"
    assert calls[0]["phone"] == "85999999999"
    assert calls[0]["plan"] == "pocket"
    assert calls[0]["billing_cycle"] == "mensal"

    duplicate = client.post("/api/contracts/accept", json=payload)
    assert duplicate.status_code == 409
    assert len(calls) == 1


def test_provider_failure_never_escapes_notification_boundary(monkeypatch):
    monkeypatch.setattr(settings, "KOMA_WHATSAPP_AUTOMATION_ENABLED", True)
    monkeypatch.setattr(contract_notifications.time, "sleep", lambda _seconds: None)

    attempts = 0

    def fail_send(*args, **kwargs):
        nonlocal attempts
        attempts += 1
        raise RuntimeError("provider down")

    monkeypatch.setattr(contract_notifications, "enviar_texto_whatsapp_detalhado", fail_send)

    delivered = contract_notifications.notify_customer_contract_accepted(
        phone="85999999999",
        representative_name="Responsável",
        restaurant_name="Restaurante",
        plan="pocket",
        protocol="KOMA-CTR-20260906-ABCDEF123456",
    )
    assert delivered is False
    assert attempts == 3


def test_activation_token_is_used_for_delivery_but_never_logged(monkeypatch, caplog):
    monkeypatch.setattr(settings, "KOMA_WHATSAPP_AUTOMATION_ENABLED", True)
    sent: list[tuple[str, str, str]] = []

    def fake_send(phone: str, message: str, *, contexto: str):
        sent.append((phone, message, contexto))
        return SimpleNamespace(
            sucesso=True,
            provider="evolution",
            message_id="msg-safe",
            error_message=None,
        )

    monkeypatch.setattr(contract_notifications, "enviar_texto_whatsapp_detalhado", fake_send)
    token = "invite-token-must-stay-private"

    with caplog.at_level(logging.INFO, logger="koma.contract_notifications"):
        delivered = contract_notifications.notify_customer_activation(
            phone="85999999999",
            representative_name="Responsável",
            restaurant_name="Restaurante",
            protocol="KOMA-CTR-20260906-ABCDEF123456",
            invitation_token=token,
            invitation_ttl_hours=72,
        )

    assert delivered is True
    assert len(sent) == 1
    assert token in sent[0][1]
    assert "/ativar?token=" in sent[0][1]
    assert token not in caplog.text
    assert "85999999999" not in caplog.text


def test_owner_notification_requires_private_runtime_phone(monkeypatch):
    monkeypatch.setattr(settings, "KOMA_WHATSAPP_AUTOMATION_ENABLED", True)
    monkeypatch.delenv("KOMA_OWNER_WHATSAPP_PHONE", raising=False)
    called = False

    def fake_send(*args, **kwargs):
        nonlocal called
        called = True
        raise AssertionError("sender should not be called without owner phone")

    monkeypatch.setattr(contract_notifications, "enviar_texto_whatsapp_detalhado", fake_send)

    assert contract_notifications.notify_owner_new_contract(
        restaurant_name="Restaurante",
        representative_name="Responsável",
        plan="pocket",
        billing_cycle="mensal",
        protocol="KOMA-CTR-20260906-ABCDEF123456",
    ) is False
    assert called is False
