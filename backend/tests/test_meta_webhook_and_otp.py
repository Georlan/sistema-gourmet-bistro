from fastapi.testclient import TestClient
from app.main import app
from app.services.whatsapp import enviar_otp_whatsapp_meta

client = TestClient(app)


def test_meta_webhook_verification_handshake_success():
    response = client.get(
        "/api/whatsapp/webhook",
        params={
            "hub.mode": "subscribe",
            "hub.verify_token": "1505",
            "hub.challenge": "challenge_code_98765"
        }
    )
    assert response.status_code == 200
    assert response.text == "challenge_code_98765"


def test_meta_webhook_verification_handshake_failure():
    response = client.get(
        "/api/whatsapp/webhook",
        params={
            "hub.mode": "subscribe",
            "hub.verify_token": "invalid_token_999",
            "hub.challenge": "challenge_code_98765"
        }
    )
    assert response.status_code == 403


def test_meta_webhook_event_post():
    response = client.post(
        "/api/whatsapp/webhook",
        json={"object": "whatsapp_business_account", "entry": []}
    )
    assert response.status_code == 200
    assert response.json() == {"status": "EVENT_RECEIVED"}


def test_enviar_otp_whatsapp_meta_simulated():
    res = enviar_otp_whatsapp_meta(
        telefone="88999616937",
        nome_restaurante="Bistrô Kôma Teste",
        codigo_otp="849201"
    )
    # Returns False gracefully in test environment without raising exceptions
    assert res is False
