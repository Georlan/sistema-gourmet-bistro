import datetime

from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models import KomaEventLead
from app.routes.cearatech_leads import _lead_submission_limiter
from app.routes.super_admin import get_current_admin


def _admin_override():
    return {"user": "crm-test", "role": "superadmin"}


def _seed_lead():
    db = SessionLocal()
    now = datetime.datetime.now(datetime.timezone.utc)
    lead = KomaEventLead(
        nome="Lead CRM",
        whatsapp_raw="(85) 99999-1111",
        whatsapp_normalizado="5585999991111",
        empresa_nome="Burger CRM",
        segmento="Hamburgueria",
        event_slug="ceara-tech-summit-2026",
        source="qr_tela",
        consent_whatsapp=True,
        consent_at=now,
        consent_version="v1_cearatech_2026",
        status="new",
        created_at=now,
        updated_at=now,
    )
    db.add(lead)
    db.commit()
    db.refresh(lead)
    lead_id = lead.id
    db.close()
    return lead_id


def test_crm_requires_superadmin():
    client = TestClient(app)
    response = client.get("/api/leads/admin")
    assert response.status_code == 401


def test_crm_list_update_search_and_immutable_consent():
    _lead_submission_limiter.history.clear()
    lead_id = _seed_lead()
    app.dependency_overrides[get_current_admin] = _admin_override
    client = TestClient(app)
    try:
        listed = client.get("/api/leads/admin", params={"event_slug": "ceara-tech-summit-2026", "search": "Burger CRM"})
        assert listed.status_code == 200
        payload = listed.json()
        assert payload["total"] >= 1
        assert any(item["id"] == lead_id for item in payload["leads"])

        changed = client.patch(
            f"/api/leads/admin/{lead_id}",
            json={
                "status": "qualified",
                "cidade": "Fortaleza",
                "quantidade_unidades": 2,
                "sistema_atual": "Outro sistema",
                "principal_dor": "Centralizar pedidos e caixa",
                "interesse": "Caixa + cardápio online",
                "notes": "Conversou no evento.",
            },
        )
        assert changed.status_code == 200
        updated = changed.json()
        assert updated["status"] == "qualified"
        assert updated["cidade"] == "Fortaleza"
        assert updated["quantidade_unidades"] == 2
        assert updated["consent_whatsapp"] is True

        forbidden = client.patch(
            f"/api/leads/admin/{lead_id}",
            json={"consent_whatsapp": False},
        )
        assert forbidden.status_code == 422
    finally:
        app.dependency_overrides.pop(get_current_admin, None)
        db = SessionLocal()
        db.query(KomaEventLead).filter(KomaEventLead.id == lead_id).delete()
        db.commit()
        db.close()


def test_contacted_status_sets_contact_timestamp():
    lead_id = _seed_lead()
    app.dependency_overrides[get_current_admin] = _admin_override
    client = TestClient(app)
    try:
        response = client.patch(f"/api/leads/admin/{lead_id}", json={"status": "contacted"})
        assert response.status_code == 200
        payload = response.json()
        assert payload["status"] == "contacted"
        assert payload["contacted_at"] is not None
    finally:
        app.dependency_overrides.pop(get_current_admin, None)
        db = SessionLocal()
        db.query(KomaEventLead).filter(KomaEventLead.id == lead_id).delete()
        db.commit()
        db.close()
