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


def test_meta_otp_template_mode(monkeypatch):
    import httpx
    from app.config import settings

    monkeypatch.setattr(settings, "META_ACCESS_TOKEN", "mock_token_123")
    monkeypatch.setattr(settings, "META_PHONE_NUMBER_ID", "1206090279260222")
    monkeypatch.setattr(settings, "META_USE_TEMPLATE", True)
    monkeypatch.setattr(settings, "META_OTP_TEMPLATE_NAME", "koma_otp")

    posted_payload = {}

    class MockResponse:
        status_code = 200
        text = '{"messages":[{"id":"wmid.123"}]}'
        def json(self):
            return {"messages": [{"id": "wmid.123"}]}

    def mock_post(self, url, headers=None, json=None, **kwargs):
        nonlocal posted_payload
        posted_payload = json
        return MockResponse()

    monkeypatch.setattr(httpx.Client, "post", mock_post)

    res = enviar_otp_whatsapp_meta(
        telefone="88999616937",
        nome_restaurante="Bistrô Kôma Teste",
        codigo_otp="849201"
    )
    assert res is True
    assert posted_payload.get("type") == "template"
    assert posted_payload.get("template", {}).get("name") == "koma_otp"
    assert posted_payload.get("template", {}).get("components")[0]["parameters"][1]["text"] == "849201"


def test_meta_webhook_real_payload_parsing_and_persistence():
    from app.database import SessionLocal
    from app.models import NotificacaoWhatsApp
    from app.services.whatsapp import obter_diagnostico_whatsapp

    real_payload = {
        "object": "whatsapp_business_account",
        "entry": [{
            "id": "2109845133274480",
            "changes": [{
                "value": {
                    "messaging_product": "whatsapp",
                    "metadata": {"display_phone_number": "15556698832", "phone_number_id": "1206090279260222"},
                    "statuses": [{
                        "id": "wamid.HBgMNTU4ODk5NjE2OTM3FQIAERgSOUE5M0ZFRTg3RDBDMEVBNkU0AA==",
                        "status": "failed",
                        "timestamp": "1785786720",
                        "recipient_id": "558899616937",
                        "errors": [{"code": 130497, "title": "Business account is restricted..."}]
                    }]
                },
                "field": "messages"
            }]
        }]
    }

    response = client.post("/api/whatsapp/webhook", json=real_payload)
    assert response.status_code == 200
    assert response.json() == {"status": "EVENT_RECEIVED"}

    # Check state update
    diag = obter_diagnostico_whatsapp()
    assert diag["meta"]["country_restriction"] is True
    assert "130497" in diag["meta"]["last_error"]

    # Check DB record
    db = SessionLocal()
    try:
        record = db.query(NotificacaoWhatsApp).filter(
            NotificacaoWhatsApp.wamid == "wamid.HBgMNTU4ODk5NjE2OTM3FQIAERgSOUE5M0ZFRTg3RDBDMEVBNkU0AA=="
        ).first()
        assert record is not None
        assert record.recipient_id == "558899616937"
        assert record.status == "failed"
        assert record.error_code == 130497
        assert record.error_title == "Business account is restricted..."
    finally:
        db.close()


def test_meta_webhook_incoming_message_payload():
    incoming_payload = {
        "object": "whatsapp_business_account",
        "entry": [{
            "id": "2109845133274480",
            "changes": [{
                "value": {
                    "messaging_product": "whatsapp",
                    "metadata": {"display_phone_number": "15556698832", "phone_number_id": "1206090279260222"},
                    "messages": [{
                        "from": "558899616937",
                        "id": "wamid.HBgMNTU4ODk5NjE2OTM3",
                        "timestamp": "1785786730",
                        "text": {"body": "Olá, qual o horário de funcionamento?"},
                        "type": "text"
                    }]
                },
                "field": "messages"
            }]
        }]
    }

    response = client.post("/api/whatsapp/webhook", json=incoming_payload)
    assert response.status_code == 200
    assert response.json() == {"status": "EVENT_RECEIVED"}




