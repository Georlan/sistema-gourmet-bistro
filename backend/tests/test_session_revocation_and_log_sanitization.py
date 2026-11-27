"""Regressões de segurança para revogação de sessão em rotas legadas e sanitização de logs (RT-06, RT-09)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.logging_security import redact_sensitive_headers, redact_sensitive_query_values
from app.main import app
from app.models import Restaurante, Usuario
from app.security import create_access_token, get_password_hash, revoke_user_sessions


def test_legacy_caixa_config_bridge_rejects_revoked_and_inactive_tokens():
    db = SessionLocal()
    try:
        if db.query(Restaurante).filter(Restaurante.id == 1).first() is None:
            db.add(Restaurante(id=1, nome="Restaurante Bridge", slug="rest-bridge", plano="premium", saas_status="active"))
            db.flush()
        user = db.query(Usuario).filter(Usuario.id == "rt-bridge-user").first()
        if user is None:
            user = Usuario(
                id="rt-bridge-user",
                restaurante_id=1,
                nome="Bridge User",
                email="bridge@koma.invalid",
                cargo="caixa",
                role="caixa",
                status="ativo",
                senha_hash=get_password_hash("BridgePass!1"),
            )
            db.add(user)
            db.commit()
    finally:
        db.close()

    token = create_access_token(subject="rt-bridge-user", restaurante_id=1, token_version=1)
    with TestClient(app) as client:
        assert client.get("/caixa/config-cardapio").status_code == 401
        ok = client.get("/caixa/config-cardapio", headers={"Authorization": f"Bearer {token}"})
        assert ok.status_code == 200
        assert ok.json()["id"] == 1

        db = SessionLocal()
        try:
            revoke_user_sessions(db, user_id="rt-bridge-user", restaurante_id=1)
            db.commit()
        finally:
            db.close()

        revoked = client.get("/caixa/config-cardapio", headers={"Authorization": f"Bearer {token}"})
        assert revoked.status_code == 401


def test_logging_security_redacts_possession_query_params_and_headers():
    urls = [
        "GET /cardapio/pedidos/cmd-101/status?key=secret-idem-123",
        "POST /cardapio/pedidos/cmd-101/pix-informado?key=secret-idem-456",
        "GET /api/cardapio-digital/public?qa_token=101.secret-qa-token",
        "GET /api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=secret-meta-verify&hub.challenge=abc",
        "GET /api/cardapio/pedidos/acompanhar/high-entropy-tok-999/summary",
    ]
    for raw in urls:
        redacted = redact_sensitive_query_values(raw)
        for secret in ("secret-idem-123", "secret-idem-456", "101.secret-qa-token", "secret-meta-verify", "high-entropy-tok-999"):
            assert secret not in redacted
        assert "[REDACTED]" in redacted

    sanitized_headers = redact_sensitive_headers({
        "Authorization": "Bearer jwt-secret",
        "X-Koma-Customer-Token": "cust-secret",
        "X-Koma-Delivery-Token": "deliv-secret",
        "X-Koma-QA-Token": "qa-secret",
        "X-Signup-Token": "signup-secret",
        "X-Agent-Token": "koma_ag_secret",
        "X-Request-ID": "req-12345678",
    })
    assert sanitized_headers["Authorization"] == "[REDACTED]"
    assert sanitized_headers["X-Koma-Customer-Token"] == "[REDACTED]"
    assert sanitized_headers["X-Koma-Delivery-Token"] == "[REDACTED]"
    assert sanitized_headers["X-Koma-QA-Token"] == "[REDACTED]"
    assert sanitized_headers["X-Signup-Token"] == "[REDACTED]"
    assert sanitized_headers["X-Agent-Token"] == "[REDACTED]"
    assert sanitized_headers["X-Request-ID"] == "req-12345678"
