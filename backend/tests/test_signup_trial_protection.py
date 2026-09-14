from app.config import settings
from app.models import Restaurante
from app.routes import saas_billing
from app.saas_billing_models import SaaSBillingSetup
from app.services.saas_mercadopago import SaasMercadoPagoError
from test_saas_billing_checkout import client_and_session, _contract_payload


def test_authorized_card_is_paused_before_manual_release(client_and_session, monkeypatch):
    client, Session = client_and_session
    monkeypatch.setattr(settings, "KOMA_SAAS_MANUAL_RELEASE_REQUIRED", True)
    pause_calls: list[str] = []
    monkeypatch.setattr(
        saas_billing,
        "pause_provider_during_onboarding",
        lambda sub_id: pause_calls.append(sub_id) or {"id": sub_id, "status": "paused"},
    )

    protocol = client.post("/api/contracts/accept", json=_contract_payload()).json()["protocol"]
    response = client.post(
        f"/api/contracts/{protocol}/billing/setup",
        json={"payment_method_type": "credit_card", "card_token_id": "test-token"},
    )

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "awaiting_release"
    assert len(pause_calls) == 1

    with Session() as db:
        setup = db.query(SaaSBillingSetup).one()
        assert setup.status == "ready"
        assert setup.provider_subscription_id == pause_calls[0]
        assert setup.restaurante_id is None
        assert db.query(Restaurante).count() == 0


def test_pause_failure_keeps_signup_pending_and_does_not_release_tenant(client_and_session, monkeypatch):
    client, Session = client_and_session
    monkeypatch.setattr(settings, "KOMA_SAAS_MANUAL_RELEASE_REQUIRED", True)

    def fail_pause(_sub_id: str):
        raise SaasMercadoPagoError("temporary provider failure")

    monkeypatch.setattr(saas_billing, "pause_provider_during_onboarding", fail_pause)

    protocol = client.post("/api/contracts/accept", json=_contract_payload()).json()["protocol"]
    response = client.post(
        f"/api/contracts/{protocol}/billing/setup",
        json={"payment_method_type": "credit_card", "card_token_id": "test-token"},
    )

    assert response.status_code == 502, response.text
    assert "pausar a recorrência" in response.text

    with Session() as db:
        setup = db.query(SaaSBillingSetup).one()
        assert setup.status == "pending"
        assert setup.provider_subscription_id
        assert setup.restaurante_id is None
        assert db.query(Restaurante).count() == 0
