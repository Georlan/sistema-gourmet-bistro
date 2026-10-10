"""
Testes da rota e do serviço de leads do Ceará Tech Summit 2026.
"""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.database import SessionLocal
from app.models import KomaEventLead
from app.routes.cearatech_leads import _lead_submission_limiter
from app.routes.super_admin import get_current_admin
from app.services.cearatech_promo_printer import (
    DEFAULT_CANONICAL_URL,
    build_cearatech_promo_escpos,
    generate_cearatech_promo_image,
)


@pytest.fixture(autouse=True)
def acquisition_schema():
    from app.database import engine
    from app.signup_models import SignupBase
    from app.contract_models import ContractEvidenceBase
    SignupBase.metadata.create_all(engine)
    ContractEvidenceBase.metadata.create_all(engine)


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



@pytest.fixture
def admin_client(client):
    app.dependency_overrides[get_current_admin] = lambda: {"user": "crm-test-admin", "role": "superadmin"}
    try:
        yield client
    finally:
        app.dependency_overrides.pop(get_current_admin, None)


def test_crm_list_requires_superadmin(client):
    response = client.get("/api/leads/cearatech")
    assert response.status_code == 401


def test_crm_search_filter_update_and_consent_immutability(admin_client):
    event_slug = "crm-test-event-2026"
    db_session = SessionLocal()
    try:
        db_session.query(KomaEventLead).filter(KomaEventLead.event_slug == event_slug).delete(
            synchronize_session=False
        )
        db_session.commit()

        first = admin_client.post(
            "/api/leads/cearatech",
            json={
                "nome": "Ana Hamburgueria",
                "whatsapp": "85911112222",
                "empresa_nome": "Smash Ana",
                "segmento": "Hamburgueria",
                "consent_whatsapp": True,
                "event_slug": event_slug,
                "source": "qr_tela",
            },
        )
        second = admin_client.post(
            "/api/leads/cearatech",
            json={
                "nome": "Bruno Pizzaria",
                "whatsapp": "85933334444",
                "empresa_nome": "Pizza Bruno",
                "segmento": "Pizzaria",
                "consent_whatsapp": True,
                "event_slug": event_slug,
                "source": "link_direto",
            },
        )
        assert first.status_code == 201
        assert second.status_code == 201
        first_id = first.json()["lead_id"]

        listed = admin_client.get(
            "/api/leads/cearatech",
            params={"event_slug": event_slug, "search": "Smash"},
        )
        assert listed.status_code == 200
        body = listed.json()
        assert body["total"] == 1
        assert body["stats"]["total"] == 1
        assert body["leads"][0]["id"] == first_id
        assert body["leads"][0]["source"] == "qr_tela"

        updated = admin_client.patch(
            f"/api/leads/cearatech/{first_id}",
            json={
                "status": "qualified",
                "cidade": "Fortaleza",
                "quantidade_unidades": 2,
                "sistema_atual": "Planilha",
                "principal_dor": "Centralizar pedidos",
                "interesse": "Caixa e cardápio online",
                "melhor_horario_contato": "14h às 16h",
                "notes": "Conversou após a apresentação.",
            },
        )
        assert updated.status_code == 200
        payload = updated.json()
        assert payload["status"] == "qualified"
        assert payload["cidade"] == "Fortaleza"
        assert payload["quantidade_unidades"] == 2
        assert payload["consent_whatsapp"] is True

        filtered = admin_client.get(
            "/api/leads/cearatech",
            params={"event_slug": event_slug, "status": "qualified"},
        )
        assert filtered.status_code == 200
        assert filtered.json()["total"] == 1
        assert filtered.json()["leads"][0]["id"] == first_id

        forbidden_consent_edit = admin_client.patch(
            f"/api/leads/cearatech/{first_id}",
            json={"consent_whatsapp": False},
        )
        assert forbidden_consent_edit.status_code == 422
        detail = admin_client.get(f"/api/leads/cearatech/{first_id}")
        assert detail.status_code == 200
        assert detail.json()["consent_whatsapp"] is True
    finally:
        db_session.rollback()
        db_session.query(KomaEventLead).filter(KomaEventLead.event_slug == event_slug).delete(
            synchronize_session=False
        )
        db_session.commit()
        db_session.close()


def test_crm_history_contact_timestamp_and_noop(admin_client):
    created = admin_client.post('/api/leads/cearatech', json={
        'nome': 'Histórico Teste', 'whatsapp': '85976543210',
        'consent_whatsapp': True, 'event_slug': 'crm-history-test',
    })
    lead_id = created.json()['lead_id']
    url = f'/api/leads/cearatech/{lead_id}'
    original = admin_client.get(url).json()
    updated = admin_client.patch(url, json={'status': 'contacted', 'last_contact_at': None, 'notes': 'Primeira conversa'})
    assert updated.status_code == 200
    data = updated.json()
    assert data['last_contact_at']
    assert len(data['history']) == 1
    assert data['history'][0]['actor'] == 'crm-test-admin'
    assert data['history'][0]['changes']['status'] == {'before': 'new', 'after': 'contacted'}
    assert data['consent_at'] == original['consent_at']
    repeated = admin_client.patch(url, json={'status': 'contacted', 'last_contact_at': data['last_contact_at'], 'notes': 'Primeira conversa'})
    assert repeated.status_code == 200
    assert len(repeated.json()['history']) == 1
    assert repeated.json()['updated_at'] == data['updated_at']
    assert admin_client.patch(url, json={'status': None}).status_code == 422
    assert admin_client.patch(url, json={'status': 'unknown'}).status_code == 422
    assert len(admin_client.get(url).json()['history']) == 1


def test_crm_detail_and_patch_require_superadmin(client):
    assert client.get('/api/leads/cearatech/1').status_code == 401
    assert client.patch('/api/leads/cearatech/1', json={'status': 'converted'}).status_code == 401


def test_siara_canonical_and_legacy_routes_share_leads_and_consent(admin_client, client):
    old = admin_client.post('/api/leads/cearatech', json={
        'nome': 'Siará Alias Teste', 'whatsapp': '85965432109',
        'consent_whatsapp': True, 'event_slug': 'ceara-tech-summit-2026',
    })
    lead_id = old.json()['lead_id']
    original = admin_client.get(f'/api/leads/cearatech/{lead_id}').json()
    new = admin_client.post('/api/leads/siaratech', json={
        'nome': 'Siará Alias Teste', 'whatsapp': '85965432109',
        'consent_whatsapp': True, 'event_slug': 'siara-tech-summit-2026',
    })
    assert new.status_code == 201
    assert new.json()['deduplicated'] is True
    assert new.json()['lead_id'] == lead_id
    detail = admin_client.get(f'/api/leads/siaratech/{lead_id}').json()
    assert detail['consent_at'] == original['consent_at']
    assert detail['consent_version'] == original['consent_version']
    canonical = admin_client.get('/api/leads/siaratech', params={'event_slug':'siara-tech-summit-2026'}).json()
    legacy = admin_client.get('/api/leads/cearatech', params={'event_slug':'ceara-tech-summit-2026'}).json()
    assert canonical['total'] == legacy['total']
    assert any(lead['id'] == lead_id for lead in canonical['leads'])
    assert admin_client.patch(f'/api/leads/siaratech/{lead_id}', json={'status':'qualified'}).status_code == 200
    assert admin_client.get(f'/api/leads/cearatech/{lead_id}').json()['status'] == 'qualified'


def test_siara_canonical_routes_require_superadmin(client):
    assert client.get('/api/leads/siaratech').status_code == 401
    assert client.get('/api/leads/siaratech/1').status_code == 401
    assert client.patch('/api/leads/siaratech/1', json={'status':'contacted'}).status_code == 401


def test_event_visit_dedup_and_qualification_owner_queue(admin_client, monkeypatch):
    import uuid
    from app.config import settings
    from app.signup_models import SignupNotification
    from app.models import KomaEventVisit
    from app.crypt import decrypt_field
    monkeypatch.setattr(settings, "EVENT_LEADS_OWNER_EMAIL", "owner@example.test")
    visit_id = str(uuid.uuid4())
    for _ in range(2):
        assert admin_client.post("/api/leads/siaratech/visits", json={"visit_id": visit_id, "source": "qr_tela"}).status_code == 204
    payload = {"nome": "Acquisition Test", "whatsapp": "85991239876", "consent_whatsapp": True,
        "sistema_atual": "Sistema existente", "principal_dor": "Fechamento de caixa", "visit_id": visit_id}
    response = admin_client.post("/api/leads/siaratech", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert data["signup_url"].startswith("/contratar?event_ref=")
    assert admin_client.post("/api/leads/siaratech", json={**payload, "sistema_atual": ""}).status_code == 201
    with SessionLocal() as db:
        assert db.query(KomaEventVisit).filter_by(visit_id=visit_id).count() == 1
        lead = db.get(KomaEventLead, data["lead_id"])
        assert lead.sistema_atual == "Sistema existente"
        assert lead.principal_dor == "Fechamento de caixa"
        notices = db.query(SignupNotification).filter(SignupNotification.id == f"event-lead-{lead.id}:event-lead-owner:email").all()
        assert len(notices) == 1
        assert 'owner@example.test' in decrypt_field(notices[0].payload_encrypted)
    assert admin_client.get("/api/leads/siaratech").json()["acquisition"]["visits"] >= 1


def test_signed_attribution_does_not_accept_auth_token_or_tampering(admin_client):
    from app.services.event_acquisition import attribute_signup, signup_url
    from app.models import KomaEventAttribution
    import uuid
    response = admin_client.post("/api/leads/siaratech", json={"nome": "Referral Test", "whatsapp": "85991239877", "consent_whatsapp": True})
    with SessionLocal() as db:
        lead = db.get(KomaEventLead, response.json()["lead_id"])
        token = signup_url(lead).split("event_ref=")[1]
        good, bad = str(uuid.uuid4()), str(uuid.uuid4())
        attribute_signup(db, good, token)
        attribute_signup(db, bad, token + "tampered")
        db.commit()
        assert db.get(KomaEventAttribution, good).lead_id == lead.id
        assert db.get(KomaEventAttribution, bad) is None


def test_landing_lead_queues_email_and_telegram_once(client, monkeypatch):
    from app.config import settings
    from app.signup_models import SignupNotification
    from app.crypt import decrypt_field
    monkeypatch.setattr(settings, "EVENT_LEADS_OWNER_EMAIL", "owner@example.test")
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "test-token")
    monkeypatch.setenv("TELEGRAM_CHAT_ID", "test-chat")
    payload = {"nome": "Landing Test", "empresa_nome": "Demo Test", "whatsapp": "85911112222", "consent_whatsapp": True,
               "event_slug": "spoofed-event", "source": "qr_tela"}
    response = client.post('/api/leads/landing', json=payload)
    assert response.status_code == 201
    with SessionLocal() as db:
        lead = db.get(KomaEventLead, response.json()['lead_id'])
        assert lead.event_slug == 'koma-landing'
        assert lead.source == 'landing'
        notices = db.query(SignupNotification).filter(SignupNotification.id.like(f'event-lead-{lead.id}:%')).all()
        assert len(notices) == 2
        assert {n.id.rsplit(':', 1)[1] for n in notices} == {'email', 'telegram'}
        assert all('Demo Test' in decrypt_field(n.payload_encrypted) for n in notices)
    retry = client.post('/api/leads/landing', json=payload)
    assert retry.json()['deduplicated'] is True
    assert retry.json()['lead_id'] == response.json()['lead_id']
    rejected = client.post('/api/leads/landing', json={**payload, 'consent_whatsapp': False})
    assert rejected.status_code == 422
