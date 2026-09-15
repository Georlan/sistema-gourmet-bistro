from __future__ import annotations

from app.fiscal.reference_watch_runner import (
    FISCAL_REFERENCE_WATCH_LOCK_KEY,
    _try_acquire_watch_lock,
)
from app.fiscal.reference_watch_worker import reference_watch_interval_seconds
from app.routes import fiscal_reference_runtime


class _Dialect:
    def __init__(self, name: str):
        self.name = name


class _Bind:
    def __init__(self, name: str):
        self.dialect = _Dialect(name)


class _ScalarResult:
    def __init__(self, value: bool):
        self.value = value

    def scalar(self):
        return self.value


class _FakeDb:
    def __init__(self, dialect: str, *, acquired: bool = True):
        self.bind = _Bind(dialect)
        self.acquired = acquired
        self.calls = []

    def get_bind(self):
        return self.bind

    def execute(self, statement, params):
        self.calls.append((str(statement), params))
        return _ScalarResult(self.acquired)


def test_sqlite_reference_watch_does_not_need_distributed_lock():
    db = _FakeDb("sqlite")
    assert _try_acquire_watch_lock(db) is True
    assert db.calls == []


def test_postgres_reference_watch_uses_single_global_advisory_lock():
    db = _FakeDb("postgresql", acquired=False)
    assert _try_acquire_watch_lock(db) is False
    assert len(db.calls) == 1
    sql, params = db.calls[0]
    assert "pg_try_advisory_xact_lock" in sql
    assert params == {"lock_key": FISCAL_REFERENCE_WATCH_LOCK_KEY}


def test_reference_watch_interval_has_one_hour_safety_floor(monkeypatch):
    monkeypatch.setenv("FISCAL_REFERENCE_WATCH_INTERVAL_HOURS", "0.1")
    assert reference_watch_interval_seconds() == 3600.0

    monkeypatch.setenv("FISCAL_REFERENCE_WATCH_INTERVAL_HOURS", "24")
    assert reference_watch_interval_seconds() == 86400.0


def test_reference_watch_runtime_is_opt_in_and_never_runs_in_tests(monkeypatch):
    monkeypatch.setenv("ENABLE_FISCAL_REFERENCE_WATCHER", "true")
    monkeypatch.setenv("ENVIRONMENT", "test")
    assert fiscal_reference_runtime._enabled() is False

    monkeypatch.setenv("ENVIRONMENT", "homologation")
    assert fiscal_reference_runtime._enabled() is True

    monkeypatch.setenv("ENABLE_FISCAL_REFERENCE_WATCHER", "false")
    assert fiscal_reference_runtime._enabled() is False
