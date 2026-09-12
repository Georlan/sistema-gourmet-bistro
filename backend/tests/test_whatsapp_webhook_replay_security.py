import hashlib
import hmac
import json

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.config import settings
from app.database import Base, TenantSession
from app.models import NotificacaoWhatsApp
from app.routes import whatsapp_webhook

APP_SECRET = "app-secret-replay-test"
PHONE_NUMBER_ID = "phone-replay-test"


def _payload(wamid: str, status: str) -> dict:
    return {
        "object": "whatsapp_business_account",
        "entry": [
            {
                "id": "business-replay-test",
                "changes": [
                    {
                        "field": "messages",
                        "value": {
                            "messaging_product": "whatsapp",
                            "metadata": {"phone_number_id": PHONE_NUMBER_ID},
                            "statuses": [{"id": wamid, "status": status}],
                        },
                    }
                ],
            }
        ],
    }


def _signed_post(client: TestClient, payload: dict):
    body = json.dumps(payload, separators=(",", ":")).encode()
    signature = "sha256=" + hmac.new(
        APP_SECRET.encode(), body, hashlib.sha256
    ).hexdigest()
    return client.post(
        "/api/whatsapp/webhook",
        content=body,
        headers={
            "content-type": "application/json",
            "x-hub-signature-256": signature,
        },
    )


def test_signed_replay_cannot_downgrade_delivered_notification(tmp_path, monkeypatch):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'replay.sqlite3'}",
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
    monkeypatch.setattr(settings, "META_APP_SECRET", APP_SECRET)
    monkeypatch.setattr(settings, "META_PHONE_NUMBER_ID", PHONE_NUMBER_ID)

    wamid = "wamid.replay-protected"
    db = factory()
    try:
        db.add(
            NotificacaoWhatsApp(
                restaurante_id=1,
                wamid=wamid,
                recipient_id="5511999999999",
                status="delivered",
                status_envio="entregue",
            )
        )
        db.commit()
    finally:
        db.close()

    app = FastAPI()
    app.include_router(whatsapp_webhook.router)
    client = TestClient(app)

    sent_replay = _signed_post(client, _payload(wamid, "sent"))
    assert sent_replay.status_code == 200
    failed_replay = _signed_post(client, _payload(wamid, "failed"))
    assert failed_replay.status_code == 200

    db = factory()
    try:
        record = db.query(NotificacaoWhatsApp).filter(
            NotificacaoWhatsApp.wamid == wamid
        ).one()
        assert record.status == "delivered"
        assert record.status_envio == "entregue"
        assert record.error_code is None
        assert record.error_title is None
    finally:
        db.close()
        Base.metadata.drop_all(engine)
        engine.dispose()
