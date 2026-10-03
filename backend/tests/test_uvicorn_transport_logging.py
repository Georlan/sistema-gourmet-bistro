import io
import logging
import sys

import pytest
from app.logging_security import install_sensitive_query_log_filter


@pytest.fixture
def transport_logs(monkeypatch):
    stdout, stderr = io.StringIO(), io.StringIO()
    monkeypatch.setattr(sys, "stdout", stdout)
    monkeypatch.setattr(sys, "stderr", stderr)
    parent = logging.Logger("uvicorn", level=logging.INFO)
    parent.propagate = False
    parent.addHandler(logging.StreamHandler(stderr))
    error = logging.Logger("uvicorn.error", level=logging.INFO)
    error.parent = parent
    access = logging.Logger("uvicorn.access", level=logging.INFO)
    access.propagate = False
    access.addHandler(logging.StreamHandler(stdout))
    original = logging.getLogger
    isolated = {"uvicorn": parent, "uvicorn.error": error, "uvicorn.access": access}
    monkeypatch.setattr(logging, "getLogger", lambda name=None: isolated.get(name) or original(name))
    return error, stdout, stderr


def test_normal_websocket_messages_are_information_not_stderr_errors(transport_logs):
    logger, stdout, stderr = transport_logs
    install_sensitive_query_log_filter()
    logger.info('%s - "WebSocket %s" [accepted]', "127.0.0.1", "/ws?token=SECRET_SENTINEL")
    logger.info("connection open")
    logger.info("connection closed")
    assert "[accepted]" in stdout.getvalue()
    assert "connection open" in stdout.getvalue()
    assert stderr.getvalue() == ""
    assert "SECRET_SENTINEL" not in stdout.getvalue()
    assert "[REDACTED]" in stdout.getvalue()
    logger.warning("slow transport")
    logger.error("real transport failure")
    assert "slow transport" in stderr.getvalue()
    assert "real transport failure" in stderr.getvalue()
    assert "real transport failure" not in stdout.getvalue()


def test_transport_logger_installation_does_not_duplicate_information(transport_logs):
    logger, stdout, stderr = transport_logs
    install_sensitive_query_log_filter()
    install_sensitive_query_log_filter()
    logger.info("connection open")
    assert stdout.getvalue().count("connection open") == 1
    assert stderr.getvalue() == ""
