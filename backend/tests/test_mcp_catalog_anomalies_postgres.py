"""Exercise catalog modifier anomaly detection against a migrated PostgreSQL 17."""
import os

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool

from app.catalog_addons import CategoriaGrupoModificador, CategoriaRelacao
from app.database import TenantSession, tenant_session_scope
from app.mcp_db_guard import configure_readonly_tx
from app.models import (
    Categoria,
    GrupoModificador,
    OpcaoModificador,
    Produto,
    ProdutoFamiliaGrupoModificador,
    ProdutoGrupoModificador,
)
from test_engineering_mcp import (
    assert_mcp_catalog_modifier_anomalies,
    seed_mcp_catalog_anomalies_fixture,
)


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
def test_mcp_catalog_modifier_anomalies_enforce_postgres_boundaries():
    admin_engine = _disposable_engine("KOMA_MCP_PG_ADMIN_URL")
    app_engine = _disposable_engine("KOMA_MCP_PG_APP_URL")
    protected_tables = (
        Produto.__tablename__,
        Categoria.__tablename__,
        GrupoModificador.__tablename__,
        OpcaoModificador.__tablename__,
        ProdutoGrupoModificador.__tablename__,
        CategoriaGrupoModificador.__tablename__,
        CategoriaRelacao.__tablename__,
        ProdutoFamiliaGrupoModificador.__tablename__,
    )
    try:
        with Session(admin_engine) as fixture:
            assert 170000 <= int(fixture.scalar(text("SHOW server_version_num"))) < 180000
            for table in protected_tables:
                assert fixture.scalar(
                    text(
                        "SELECT relrowsecurity AND relforcerowsecurity FROM pg_class "
                        "WHERE oid = CAST(:table AS regclass)"
                    ),
                    {"table": f"public.{table}"},
                ) is True
            seed_mcp_catalog_anomalies_fixture(fixture)

        with TenantSession(bind=app_engine) as db:
            assert db.scalar(
                text(
                    "SELECT pg_has_role(session_user, 'koma_app', 'member') AND "
                    "NOT rolsuper AND NOT rolbypassrls FROM pg_roles WHERE rolname = current_user"
                )
            ) is True
            # Antes do tenant_session_scope, FORCE RLS bloqueia leitura de produtos.
            assert db.scalar(text("SELECT count(*) FROM produtos WHERE id IN ('prod-6-agua', 'prod-zero-tipos')")) == 0
            db.rollback()
            with tenant_session_scope(db, 201):
                configure_readonly_tx(db)
                assert db.scalar(text("SHOW transaction_read_only")) == "on"
                assert db.scalar(text("SHOW statement_timeout")) == "2s"
                assert db.scalar(text("SELECT count(*) FROM produtos WHERE id IN ('prod-6-agua', 'prod-zero-tipos')")) == 1

            assert_mcp_catalog_modifier_anomalies(db)
            assert db.scalar(text("SELECT count(*) FROM produtos WHERE id IN ('prod-6-agua', 'prod-zero-tipos')")) == 0
    finally:
        app_engine.dispose()
        admin_engine.dispose()
