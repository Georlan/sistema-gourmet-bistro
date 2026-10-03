import pytest

import app.database as database


class _Dialect:
    name = "postgresql"


class _Connection:
    def __init__(self, role):
        self.role = role

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, _statement):
        return self

    def mappings(self):
        return self

    def one(self):
        return self.role


class _Engine:
    dialect = _Dialect()

    def __init__(self, role):
        self.role = role

    def connect(self):
        return _Connection(self.role)


UNSAFE_ROLE = {
    "role_name": "runtime_unsafe",
    "is_superuser": False,
    "bypass_rls": True,
    "is_koma_app": True,
    "owns_tenant_table": False,
}


def test_production_cannot_disable_runtime_rls_guard(monkeypatch):
    monkeypatch.setattr(database, "engine", _Engine(UNSAFE_ROLE))
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("STRICT_RLS_ROLE_CHECK", "false")

    with pytest.raises(RuntimeError, match="produção"):
        database.validate_postgres_runtime_role()


def test_non_production_can_explicitly_override_runtime_rls_guard(monkeypatch):
    monkeypatch.setattr(database, "engine", _Engine(UNSAFE_ROLE))
    monkeypatch.setenv("ENVIRONMENT", "test")
    monkeypatch.setenv("STRICT_RLS_ROLE_CHECK", "false")

    database.validate_postgres_runtime_role()


@pytest.mark.parametrize("environment", ["production", "prod", "", "unknown"])
@pytest.mark.parametrize("failure", ["is_superuser", "bypass_rls", "owns_tenant_table", "is_koma_app"])
def test_unknown_environments_cannot_bypass_each_unsafe_role_condition(monkeypatch, environment, failure):
    role = dict(UNSAFE_ROLE, bypass_rls=False)
    role[failure] = failure != "is_koma_app"
    monkeypatch.setattr(database, "engine", _Engine(role))
    monkeypatch.setenv("ENVIRONMENT", environment)
    monkeypatch.setenv("STRICT_RLS_ROLE_CHECK", "false")
    with pytest.raises(RuntimeError):
        database.validate_postgres_runtime_role()


def test_safe_production_role_starts_with_override_disabled(monkeypatch):
    monkeypatch.setattr(database, "engine", _Engine(dict(UNSAFE_ROLE, bypass_rls=False)))
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("STRICT_RLS_ROLE_CHECK", "false")
    database.validate_postgres_runtime_role()
