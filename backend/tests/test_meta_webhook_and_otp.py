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


def test_enviar_otp_whatsapp_meta_missing_phone_number_id(monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "META_ACCESS_TOKEN", "mock_token")
    monkeypatch.setattr(settings, "META_PHONE_NUMBER_ID", "")
    res = enviar_otp_whatsapp_meta(
        telefone="88999616937",
        nome_restaurante="Bistrô Kôma Teste",
        codigo_otp="849201"
    )
    assert res is False


def test_meta_error_130497_country_restriction(monkeypatch):
    import httpx
    from app.config import settings
    from app.services.whatsapp import obter_diagnostico_whatsapp

    monkeypatch.setattr(settings, "META_ACCESS_TOKEN", "mock_token_123")
    monkeypatch.setattr(settings, "META_PHONE_NUMBER_ID", "1206090279260222")

    class MockResponse:
        status_code = 200
        text = '{"error":{"code":130497,"message":"Business account is restricted from messaging users in this country."}}'
        def json(self):
            return {"error": {"code": 130497, "message": "Business account is restricted from messaging users in this country."}}

    def mock_post(*args, **kwargs):
        return MockResponse()

    monkeypatch.setattr(httpx.Client, "post", mock_post)

    res = enviar_otp_whatsapp_meta(
        telefone="88999616937",
        nome_restaurante="Bistrô Kôma Teste",
        codigo_otp="849201"
    )
    assert res is False

    diag = obter_diagnostico_whatsapp()
    assert diag["meta"]["country_restriction"] is True
    assert "130497" in diag["meta"]["last_error"]


def test_whatsapp_diagnostico_endpoint():
    response = client.get("/api/whatsapp/diagnostico")
    assert response.status_code == 200
    data = response.json()
    assert "meta" in data
    assert "evolution" in data
    assert "phone_number_id_configured" in data["meta"]
    assert "country_restriction" in data["meta"]


