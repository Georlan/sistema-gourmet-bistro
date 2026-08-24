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
