import logging
from types import SimpleNamespace

from app.logging_security import SensitiveQueryFilter, redact_sensitive_query_values
from app.routes.websocket import _websocket_auth_token


def test_internal_websocket_prefers_token_outside_query_string():
    websocket = SimpleNamespace(
        scope={"subprotocols": ["koma-auth", "header.jwt.value"]}
    )

    assert _websocket_auth_token(websocket, "legacy.jwt.value") == "header.jwt.value"


def test_internal_websocket_keeps_legacy_clients_during_frontend_rollout():
    websocket = SimpleNamespace(scope={"subprotocols": []})

    assert _websocket_auth_token(websocket, "legacy.jwt.value") == "legacy.jwt.value"


def test_sensitive_query_filter_redacts_uvicorn_websocket_path():
    record = logging.LogRecord(
        name="uvicorn.error",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg='%s - "WebSocket %s" [accepted]',
        args=("127.0.0.1:1234", "/ws/user?token=secret.jwt.value&mode=live"),
        exc_info=None,
    )

    assert SensitiveQueryFilter().filter(record) is True
    rendered = record.getMessage()
    assert "secret.jwt.value" not in rendered
    assert "token=[REDACTED]&mode=live" in rendered


def test_redaction_is_case_insensitive_and_preserves_non_secret_query_values():
    result = redact_sensitive_query_values(
        "/socket?restaurante_id=2&Access_Token=top-secret&screen=caixa"
    )

    assert result == (
        "/socket?restaurante_id=2&Access_Token=[REDACTED]&screen=caixa"
    )


def test_internal_websocket_identity_ignores_stale_legacy_path(monkeypatch):
    from app.routes import websocket as websocket_route

    fake_db = SimpleNamespace(close=lambda: None)
    monkeypatch.setattr(
        websocket_route.jwt,
        "decode",
        lambda *args, **kwargs: {"sub": "canonical-user", "restaurante_id": 77},
    )
    monkeypatch.setattr(
        websocket_route,
        "SessionLocal",
        lambda restaurante_id=None: fake_db,
    )
    monkeypatch.setattr(
        websocket_route,
        "_authenticated_user_from_token",
        lambda token, db: SimpleNamespace(id="canonical-user", nome="Caixa"),
    )

    assert websocket_route._validated_internal_websocket_identity(
        "valid.jwt.token",
        "stale-local-storage-id",
    ) == (77, "canonical-user", "Caixa")
