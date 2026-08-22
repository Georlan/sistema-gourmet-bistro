import hashlib
import hmac
import json
import logging

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.config import settings
from app.database import Base, TenantSession
from app.models import NotificacaoWhatsApp
from app.routes import whatsapp_webhook
from app.services.whatsapp import enviar_otp_whatsapp_meta


VERIFY_TOKEN = "verify-token-only-for-tests"
APP_SECRET = "app-secret-only-for-tests"
PHONE_NUMBER_ID = "test-phone-number-id-0001"
TEST_PHONE = "5511999990000"
TEST_OTP = "123456"


@pytest.fixture(autouse=True)
def reset_meta_diagnostic(monkeypatch):
    from app.services import whatsapp as whatsapp_service

    monkeypatch.setattr(whatsapp_service, "_META_LAST_ERROR", None)
    monkeypatch.setattr(whatsapp_service, "_META_COUNTRY_RESTRICTION", False)


@pytest.fixture
def enabled_whatsapp_client(monkeypatch):
    """Monta um cliente isolado com credenciais Meta explícitas."""
    monkeypatch.setattr(settings, "KOMA_WHATSAPP_AUTOMATION_ENABLED", True)
    monkeypatch.setattr(settings, "META_VERIFY_TOKEN", VERIFY_TOKEN)
    monkeypatch.setattr(settings, "META_APP_SECRET", APP_SECRET)
    monkeypatch.setattr(settings, "META_PHONE_NUMBER_ID", PHONE_NUMBER_ID)
    isolated_app = FastAPI()
    isolated_app.include_router(whatsapp_webhook.router)
    return TestClient(isolated_app)


@pytest.fixture
def webhook_session_factory(tmp_path, monkeypatch):
    db_path = tmp_path / "meta-webhook.sqlite3"
    engine = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(
        class_=TenantSession,
        autocommit=False,
        autoflush=False,
        bind=engine,
    )
    monkeypatch.setattr(whatsapp_webhook, "SessionLocal", factory)
    try:
        yield factory
    finally:
        Base.metadata.drop_all(engine)
        engine.dispose()


def _event_payload(
    *,
    phone_number_id: str = PHONE_NUMBER_ID,
    statuses: list[dict] | None = None,
    messages: list[dict] | None = None,
) -> dict:
    value = {
        "messaging_product": "whatsapp",
        "metadata": {
            "display_phone_number": "15550000000",
            "phone_number_id": phone_number_id,
        },
    }
    if statuses is not None:
        value["statuses"] = statuses
    if messages is not None:
        value["messages"] = messages
    return {
        "object": "whatsapp_business_account",
        "entry": [
            {
                "id": "test-business-account",
                "changes": [{"value": value, "field": "messages"}],
            }
        ],
    }


def _signed_body(payload: dict, *, secret: str = APP_SECRET) -> tuple[bytes, str]:
    body = json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    signature = "sha256=" + hmac.new(
        secret.encode("utf-8"),
        body,
        hashlib.sha256,
    ).hexdigest()
    return body, signature


def _post_signed(
    client: TestClient,
    payload: dict,
    *,
    secret: str = APP_SECRET,
):
    body, signature = _signed_body(payload, secret=secret)
    return client.post(
        "/api/whatsapp/webhook",
        content=body,
        headers={
            "content-type": "application/json",
            "x-hub-signature-256": signature,
        },
    )


def test_meta_webhook_verification_handshake_success(enabled_whatsapp_client):
    response = enabled_whatsapp_client.get(
        "/api/whatsapp/webhook",
        params={
            "hub.mode": "subscribe",
            "hub.verify_token": VERIFY_TOKEN,
            "hub.challenge": "challenge_code_98765",
        },
    )
    assert response.status_code == 200
    assert response.text == "challenge_code_98765"


def test_meta_webhook_verification_handshake_failure_does_not_log_tokens(
    enabled_whatsapp_client,
    caplog,
):
    received_token = "received-token-must-not-appear"
    with caplog.at_level(logging.WARNING, logger="koma.whatsapp_webhook"):
        response = enabled_whatsapp_client.get(
            "/api/whatsapp/webhook",
            params={
                "hub.mode": "subscribe",
                "hub.verify_token": received_token,
                "hub.challenge": "challenge_code_98765",
            },
        )
    assert response.status_code == 403
    assert received_token not in caplog.text
    assert VERIFY_TOKEN not in caplog.text


def test_meta_webhook_verification_fails_closed_without_token(
    enabled_whatsapp_client,
    monkeypatch,
):
    monkeypatch.setattr(settings, "META_VERIFY_TOKEN", "")
    response = enabled_whatsapp_client.get(
        "/api/whatsapp/webhook",
        params={
            "hub.mode": "subscribe",
            "hub.verify_token": "1505",
            "hub.challenge": "challenge_code_98765",
        },
    )
    assert response.status_code == 503


def test_meta_webhook_accepts_valid_signed_event(enabled_whatsapp_client):
    response = _post_signed(
        enabled_whatsapp_client,
        _event_payload(messages=[]),
    )
    assert response.status_code == 200
    assert response.json() == {"status": "EVENT_RECEIVED"}


def test_meta_webhook_rejects_missing_signature(enabled_whatsapp_client):
    response = enabled_whatsapp_client.post(
        "/api/whatsapp/webhook",
        json=_event_payload(messages=[]),
    )
    assert response.status_code == 401


def test_meta_webhook_rejects_invalid_signature(enabled_whatsapp_client):
    response = _post_signed(
        enabled_whatsapp_client,
        _event_payload(messages=[]),
        secret="wrong-app-secret",
    )
    assert response.status_code == 401


def test_meta_webhook_rejects_signed_invalid_json(enabled_whatsapp_client):
    body = b'{"object":'
    signature = "sha256=" + hmac.new(
        APP_SECRET.encode("utf-8"),
        body,
        hashlib.sha256,
    ).hexdigest()
    response = enabled_whatsapp_client.post(
        "/api/whatsapp/webhook",
        content=body,
        headers={"x-hub-signature-256": signature},
    )
    assert response.status_code == 400


def test_meta_webhook_rejects_oversized_body(enabled_whatsapp_client):
    oversized_body = b"x" * (whatsapp_webhook._MAX_WEBHOOK_BODY_BYTES + 1)
    signature = "sha256=" + hmac.new(
        APP_SECRET.encode("utf-8"),
        oversized_body,
        hashlib.sha256,
    ).hexdigest()
    response = enabled_whatsapp_client.post(
        "/api/whatsapp/webhook",
        content=oversized_body,
        headers={"x-hub-signature-256": signature},
    )
    assert response.status_code == 413


def test_meta_webhook_rejects_signed_malformed_event(enabled_whatsapp_client):
    response = _post_signed(
        enabled_whatsapp_client,
        {"object": "whatsapp_business_account", "entry": []},
    )
    assert response.status_code == 400


def test_meta_webhook_post_fails_closed_without_app_secret(
    enabled_whatsapp_client,
    monkeypatch,
):
    monkeypatch.setattr(settings, "META_APP_SECRET", "")
    response = enabled_whatsapp_client.post(
        "/api/whatsapp/webhook",
        json=_event_payload(messages=[]),
    )
    assert response.status_code == 503


def test_meta_webhook_rejects_unconfigured_phone_number_id(enabled_whatsapp_client):
    response = _post_signed(
        enabled_whatsapp_client,
        _event_payload(phone_number_id="different-phone-number-id", messages=[]),
    )
    assert response.status_code == 403


def test_meta_webhook_updates_only_existing_tenant_notification(
    enabled_whatsapp_client,
    webhook_session_factory,
):
    known_wamid = "wamid.known-tenant-notification"
    unknown_wamid = "wamid.unknown-notification"
    db = webhook_session_factory()
    try:
        db.add(
            NotificacaoWhatsApp(
                restaurante_id=1,
                wamid=known_wamid,
                recipient_id="existing-recipient",
                status="sent",
                status_envio="enviado",
                raw_payload="legacy-sensitive-payload",
            )
        )
        db.commit()
    finally:
        db.close()

    payload = _event_payload(
        statuses=[
            {
                "id": known_wamid,
                "status": "failed",
                "recipient_id": "webhook-recipient-must-not-overwrite",
                "errors": [
                    {
                        "code": 130497,
                        "title": "Business account is restricted.",
                    }
                ],
            },
            {
                "id": unknown_wamid,
                "status": "delivered",
                "recipient_id": "unknown-recipient",
            },
        ]
    )
    response = _post_signed(enabled_whatsapp_client, payload)
    assert response.status_code == 200

    db = webhook_session_factory()
    try:
        records = db.query(NotificacaoWhatsApp).order_by(NotificacaoWhatsApp.id).all()
        assert len(records) == 1
        record = records[0]
        assert record.wamid == known_wamid
        assert record.restaurante_id == 1
        assert record.recipient_id == "existing-recipient"
        assert record.status == "failed"
        assert record.status_envio == "falhou"
        assert record.error_code == 130497
        assert record.error_title == "Business account is restricted."
        assert record.raw_payload is None
        assert db.query(NotificacaoWhatsApp).filter(
            NotificacaoWhatsApp.wamid == unknown_wamid
        ).count() == 0
    finally:
        db.close()


def test_meta_webhook_inbound_is_acknowledged_without_persistence_or_pii_logs(
    enabled_whatsapp_client,
    webhook_session_factory,
    caplog,
):
    sender = "5588999999999"
    message_body = "private inbound message body"
    incoming_payload = _event_payload(
        messages=[
            {
                "from": sender,
                "id": "wamid.inbound-message",
                "timestamp": "1785786730",
                "text": {"body": message_body},
                "type": "text",
            }
        ]
    )

    with caplog.at_level(logging.INFO, logger="koma.whatsapp_webhook"):
        response = _post_signed(enabled_whatsapp_client, incoming_payload)

    assert response.status_code == 200
    assert response.json() == {"status": "EVENT_RECEIVED"}
    assert sender not in caplog.text
    assert message_body not in caplog.text

    db = webhook_session_factory()
    try:
        assert db.query(NotificacaoWhatsApp).count() == 0
    finally:
        db.close()


def test_enviar_otp_whatsapp_meta_missing_token_does_not_log_pii_or_otp(
    monkeypatch,
    caplog,
):
    monkeypatch.setattr(settings, "KOMA_WHATSAPP_AUTOMATION_ENABLED", True)
    monkeypatch.setattr(settings, "META_ACCESS_TOKEN", "")
    with caplog.at_level(logging.WARNING, logger="koma.whatsapp"):
        response = enviar_otp_whatsapp_meta(
            telefone=TEST_PHONE,
            nome_restaurante="Restaurante privado de teste",
            codigo_otp=TEST_OTP,
        )
    assert response is False
    assert TEST_PHONE not in caplog.text
    assert TEST_OTP not in caplog.text
    assert "Restaurante privado de teste" not in caplog.text


def test_enviar_otp_whatsapp_meta_missing_phone_number_id(monkeypatch):
    monkeypatch.setattr(settings, "KOMA_WHATSAPP_AUTOMATION_ENABLED", True)
    monkeypatch.setattr(settings, "META_ACCESS_TOKEN", "mock_token")
    monkeypatch.setattr(settings, "META_PHONE_NUMBER_ID", "")
    response = enviar_otp_whatsapp_meta(
        telefone=TEST_PHONE,
        nome_restaurante="Bistrô Kôma Teste",
        codigo_otp=TEST_OTP,
    )
    assert response is False


def test_meta_error_130497_country_restriction(monkeypatch):
    import httpx

    from app.services.whatsapp import obter_diagnostico_whatsapp

    monkeypatch.setattr(settings, "KOMA_WHATSAPP_AUTOMATION_ENABLED", True)
    monkeypatch.setattr(settings, "META_ACCESS_TOKEN", "mock_token_123")
    monkeypatch.setattr(settings, "META_PHONE_NUMBER_ID", PHONE_NUMBER_ID)

    class MockResponse:
        status_code = 200
        text = (
            '{"error":{"code":130497,"message":'
            '"Business account is restricted from messaging users in this country."}}'
        )

        def json(self):
            return {
                "error": {
                    "code": 130497,
                    "message": (
                        "Business account is restricted from messaging users "
                        "in this country."
                    ),
                }
            }

    monkeypatch.setattr(httpx.Client, "post", lambda *args, **kwargs: MockResponse())

    response = enviar_otp_whatsapp_meta(
        telefone=TEST_PHONE,
        nome_restaurante="Bistrô Kôma Teste",
        codigo_otp=TEST_OTP,
    )
    assert response is False

    diagnostic = obter_diagnostico_whatsapp()
    assert diagnostic["meta"]["country_restriction"] is True
    assert "130497" in diagnostic["meta"]["last_error"]


def test_whatsapp_diagnostico_is_not_public(enabled_whatsapp_client):
    response = enabled_whatsapp_client.get("/api/whatsapp/diagnostico")
    assert response.status_code == 404


def test_meta_otp_template_mode(monkeypatch):
    import httpx

    monkeypatch.setattr(settings, "KOMA_WHATSAPP_AUTOMATION_ENABLED", True)
    monkeypatch.setattr(settings, "META_ACCESS_TOKEN", "mock_token_123")
    monkeypatch.setattr(settings, "META_PHONE_NUMBER_ID", PHONE_NUMBER_ID)
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

    response = enviar_otp_whatsapp_meta(
        telefone=TEST_PHONE,
        nome_restaurante="Bistrô Kôma Teste",
        codigo_otp=TEST_OTP,
    )
    assert response is True
    assert posted_payload.get("type") == "template"
    assert posted_payload.get("template", {}).get("name") == "koma_otp"
    parameters = posted_payload["template"]["components"][0]["parameters"]
    assert parameters[1]["text"] == TEST_OTP
