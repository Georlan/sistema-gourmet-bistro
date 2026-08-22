from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from app import main as main_module
from app.main import app
from app.migration_runtime import (
    prepare_migration_connection,
    release_migration_lock,
)


def test_liveness_does_not_depend_on_database(monkeypatch):
    monkeypatch.setenv("RAILWAY_GIT_COMMIT_SHA", "abcdef1234567890")

    with TestClient(app) as client:
        response = client.get("/health/live")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "version": main_module.settings.PROJECT_VERSION,
        "commit": "abcdef123456",
    }


def test_request_id_is_preserved_and_returned():
    with TestClient(app) as client:
        response = client.get("/health/live", headers={"X-Request-ID": "h3o-check-123"})

    assert response.status_code == 200
    assert response.headers["X-Request-ID"] == "h3o-check-123"


def test_readiness_returns_503_when_database_is_unavailable(monkeypatch):
    failing_engine = MagicMock()
    failing_engine.connect.side_effect = RuntimeError("database unavailable")
    monkeypatch.setattr(main_module, "engine", failing_engine)

    with TestClient(app) as client:
        response = client.get("/health/ready")

    assert response.status_code == 503
    payload = response.json()
    assert payload["status"] == "unavailable"
    assert payload["database"] == "unhealthy"


def test_production_does_not_create_schema_implicitly(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.delenv("CREATE_SCHEMA_ON_STARTUP", raising=False)
    production_engine = MagicMock()
    production_engine.dialect.name = "postgresql"
    monkeypatch.setattr(main_module, "engine", production_engine)

    assert main_module.should_create_schema_on_startup() is False


def _postgres_connection(*, lock_acquired: bool = True) -> MagicMock:
    connection = MagicMock()
    connection.dialect.name = "postgresql"
    lock_result = MagicMock()
    lock_result.scalar.return_value = lock_acquired
    connection.execute.return_value = lock_result
    return connection


def test_migration_runtime_sets_bounded_timeouts(monkeypatch):
    monkeypatch.setenv("MIGRATION_LOCK_TIMEOUT_MS", "12000")
    monkeypatch.setenv("MIGRATION_STATEMENT_TIMEOUT_MS", "300000")
    connection = _postgres_connection()

    assert prepare_migration_connection(connection) is True

    calls = connection.execute.call_args_list
    assert calls[1].args[1] == {"value": "12000ms"}
    assert calls[2].args[1] == {"value": "300000ms"}
    connection.commit.assert_called_once()

    release_migration_lock(connection, lock_acquired=True)
    assert connection.commit.call_count == 2


def test_migration_runtime_fails_fast_when_lock_is_busy():
    connection = _postgres_connection(lock_acquired=False)

    with pytest.raises(RuntimeError, match="Outra migração"):
        prepare_migration_connection(connection)

    connection.rollback.assert_called_once()
