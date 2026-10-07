"""
Testes da rota e do serviço de leads do Ceará Tech Summit 2026.
"""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.database import SessionLocal
from app.models import KomaEventLead
from app.routes.cearatech_leads import _lead_submission_limiter
from app.services.cearatech_promo_printer import (
    DEFAULT_CANONICAL_URL,
    build_cearatech_promo_escpos,
    generate_cearatech_promo_image,
)


@pytest.fixture
def client():
    _lead_submission_limiter.history.clear()
    return TestClient(app)


def test_submit_lead_success_and_deduplication(client):
    db_session = SessionLocal()
    try:
        # 1. Envio inicial com sucesso
        payload = {
            "nome": "Maria Empreendedora",
            "whatsapp": "(85) 99876-5432",
            "empresa_nome": "Bistrô das Dunas",
            "segmento": "Restaurante",
            "consent_whatsapp": True,
            "event_slug": "ceara-tech-summit-2026",
        }
        response = client.post("/api/leads/cearatech", json=payload)
        assert response.status_code == 201
        data = response.json()
        assert data["success"] is True
        assert data["message"] == "Contato recebido ✓"
        assert data["deduplicated"] is False
        lead_id = data["lead_id"]

        # Verificar no banco
        lead = db_session.query(KomaEventLead).filter(KomaEventLead.id == lead_id).first()
        assert lead is not None
        assert lead.nome == "Maria Empreendedora"
        assert lead.whatsapp_normalizado == "5585998765432"
        assert lead.consent_whatsapp is True
        original_consent = lead.consent_at
        original_user_agent = lead.user_agent

        # 2. Reenvio com o mesmo WhatsApp (deduplicação graciosa sem erro 409)
        payload_update = {
            "nome": "Maria Empreendedora Atualizada",
            "whatsapp": "85998765432",
            "empresa_nome": "Bistrô das Dunas Premium",
            "segmento": "Gastronomia",
            "consent_whatsapp": True,
            "event_slug": "ceara-tech-summit-2026",
        }
        response2 = client.post("/api/leads/cearatech", json=payload_update, headers={"User-Agent": "synthetic-hostile-retry"})
        assert response2.status_code == 201
        data2 = response2.json()
        assert data2["success"] is True
        assert data2["lead_id"] == lead_id
        assert data2["deduplicated"] is True

        # Um reenvio público não autoriza editar o contato ou renovar consentimento.
        db_session.expire_all()
        lead_updated = db_session.query(KomaEventLead).filter(KomaEventLead.id == lead_id).first()
        assert lead_updated.nome == "Maria Empreendedora"
        assert lead_updated.empresa_nome == "Bistrô das Dunas"
        assert lead_updated.whatsapp_raw == "(85) 99876-5432"
        assert lead_updated.consent_at == original_consent
        assert lead_updated.user_agent == original_user_agent
        assert db_session.query(KomaEventLead).filter(KomaEventLead.id == lead_id).count() == 1
    finally:
        db_session.close()


def test_submit_lead_validation_errors(client):
    # Sem consentimento LGPD -> 422
    res_no_consent = client.post(
        "/api/leads/cearatech",
        json={
            "nome": "João Silva",
            "whatsapp": "85988887777",
            "consent_whatsapp": False,
        },
    )
    assert res_no_consent.status_code == 422

    # Telefone inválido -> 422
    res_bad_phone = client.post(
        "/api/leads/cearatech",
        json={
            "nome": "João Silva",
            "whatsapp": "1234",
            "consent_whatsapp": True,
        },
    )
    assert res_bad_phone.status_code == 422

    # Nome curto demais -> 422
    res_bad_name = client.post(
        "/api/leads/cearatech",
        json={
            "nome": " ",
            "whatsapp": "85988887777",
            "consent_whatsapp": True,
        },
    )
    assert res_bad_name.status_code == 422


def test_cearatech_promo_printer_generator():
    img = generate_cearatech_promo_image(DEFAULT_CANONICAL_URL)
    assert img.width == 384
    assert img.height >= 500
    assert img.mode == "1"

    payload = build_cearatech_promo_escpos(DEFAULT_CANONICAL_URL)
    assert isinstance(payload, bytes)
    # Deve começar com ESC @ (b'\x1b@') e comando raster GS v 0 (b'\x1dv0')
    assert payload.startswith(b"\x1b@\x1dv0")
    # Deve conter comando de corte ao final
    assert b"\x1dVB\x00" in payload
