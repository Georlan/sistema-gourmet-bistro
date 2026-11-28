"""Exercise the same MCP operational aggregates against a migrated PostgreSQL 17."""
from datetime import datetime, timezone
import os

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool

from app.database import TenantSession, tenant_session_scope
from app.mcp_db_guard import configure_readonly_tx
from test_engineering_mcp import assert_mcp_ops_aggregates, seed_mcp_ops_fixture


def _disposable_engine(variable):
    url = make_url(os.environ[variable])
    assert url.get_backend_name() == "postgresql"
    assert url.host == "127.0.0.1" and url.database == "koma_mcp_boundary_test"
    assert not url.query
    return create_engine(url, poolclass=NullPool)


@pytest.mark.skipif(
    not os.getenv("KOMA_MCP_PG_ADMIN_URL"),
    reason="requires the dedicated migrated PostgreSQL 17 test database",
)
def test_engineering_mcp_operational_aggregates_enforce_postgres_boundaries():
    admin_engine = _disposable_engine("KOMA_MCP_PG_ADMIN_URL")
    app_engine = _disposable_engine("KOMA_MCP_PG_APP_URL")
    now = datetime(2026, 11, 28, 17, 30, tzinfo=timezone.utc)
    try:
        with Session(admin_engine) as fixture:
            assert 170000 <= int(fixture.scalar(text("SHOW server_version_num"))) < 180000
            for table in ("comandas", "print_jobs", "print_agent_tokens"):
                assert fixture.scalar(text(
                    "SELECT relrowsecurity AND relforcerowsecurity FROM pg_class "
                    "WHERE oid = CAST(:table AS regclass)"
                ), {"table": f"public.{table}"}) is True
            seed_mcp_ops_fixture(fixture, now)

        with TenantSession(bind=app_engine) as db:
            assert db.scalar(text(
                "SELECT pg_has_role(session_user, 'koma_app', 'member') AND "
                "NOT rolsuper AND NOT rolbypassrls FROM pg_roles WHERE rolname = current_user"
            )) is True
            assert db.scalar(text("SELECT count(*) FROM comandas WHERE id IN ('c-1', 'c-2')")) == 0
            db.rollback()
            with tenant_session_scope(db, 101):
                configure_readonly_tx(db)
                assert db.scalar(text("SHOW transaction_read_only")) == "on"
                assert db.scalar(text("SHOW statement_timeout")) == "2s"
                assert db.scalar(text("SELECT count(*) FROM comandas WHERE id IN ('c-1', 'c-2')")) == 1
            assert_mcp_ops_aggregates(db, now)
            assert db.scalar(text("SELECT count(*) FROM comandas WHERE id IN ('c-1', 'c-2')")) == 0
    finally:
        app_engine.dispose()
        admin_engine.dispose()
