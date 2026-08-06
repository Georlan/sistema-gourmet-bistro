import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.config import settings
from app.services import whatsapp as whatsapp_service

client = TestClient(app)


def test_whatsapp_automation_flag_default_is_false():
    """Confirma que a flag de automação assume False por padrão quando não definida."""
    assert settings.KOMA_WHATSAPP_AUTOMATION_ENABLED is False


def test_get_webhook_returns_404_when_automation_disabled():
    """Confirma que o endpoint GET /api/whatsapp/webhook retorna 404 quando a automação está desativada."""
    response = client.get("/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=1505&hub.challenge=test")
    assert response.status_code == 404


def test_post_webhook_returns_404_when_automation_disabled():
    """Confirma que o endpoint POST /api/whatsapp/webhook retorna 404 quando a automação está desativada."""
    response = client.post("/api/whatsapp/webhook", json={"entry": []})
    assert response.status_code == 404


def test_get_diagnostic_returns_404_when_automation_disabled():
    """Confirma que o endpoint GET /api/whatsapp/diagnostico retorna 404 quando a automação está desativada."""
    response = client.get("/api/whatsapp/diagnostico")
    assert response.status_code == 404


def test_enviar_texto_whatsapp_returns_false_without_http_calls(monkeypatch):
    """Confirma que enviar_texto_whatsapp retorna False imediatamente sem fazer requisição HTTP externa."""
    called_http = False

    def mock_post(*args, **kwargs):
        nonlocal called_http
        called_http = True
        raise RuntimeError("HTTP request não deveria ser executada com automação desativada.")

    monkeypatch.setattr(whatsapp_service.httpx.Client, "post", mock_post)

    result = whatsapp_service.enviar_texto_whatsapp("5511999999999", "Mensagem de teste")
    assert result is False
    assert called_http is False


def test_enviar_otp_whatsapp_meta_returns_false_without_http_calls(monkeypatch):
    """Confirma que enviar_otp_whatsapp_meta retorna False imediatamente sem fazer requisição HTTP externa."""
    called_http = False

    def mock_post(*args, **kwargs):
        nonlocal called_http
        called_http = True
        raise RuntimeError("HTTP request não deveria ser executada com automação desativada.")

    monkeypatch.setattr(whatsapp_service.httpx.Client, "post", mock_post)

    result = whatsapp_service.enviar_otp_whatsapp_meta("5511999999999", "Restaurante Teste", "123456")
    assert result is False
    assert called_http is False


def test_enviar_codigo_otp_whatsapp_returns_false_when_automation_disabled():
    """Confirma que o wrapper de OTP retorna False quando a automação está desativada."""
    result = whatsapp_service.enviar_codigo_otp_whatsapp("5511999999999", "123456", "Restaurante Teste")
    assert result is False


def test_solicitar_otp_endpoint_returns_503_when_automation_disabled():
    """Confirma que o endpoint de solicitação de OTP do cliente retorna 503 quando a automação está desativada."""
    response = client.post("/cardapio/clientes/otp/solicitar", json={
        "restaurante_id": 1,
        "telefone": "11999999999"
    })
    assert response.status_code == 503
    assert "WhatsApp indisponível" in response.json()["detail"]



def test_public_menu_works_without_login():
    """Confirma que o cardápio público continua acessível e operacional sem qualquer necessidade de login ou OTP."""
    response = client.get("/")
    assert response.status_code == 200
    assert response.json()["status"] == "online"
