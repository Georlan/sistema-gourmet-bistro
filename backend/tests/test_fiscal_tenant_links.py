"""Adversarial fiscal links, with actual fiscal table definitions and no live data."""
from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import uuid

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import Column, ForeignKey, Integer, MetaData, String, Table, UniqueConstraint
from sqlalchemy import create_engine, event, insert, inspect, select, text, update
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError, IntegrityError

from app.fiscal_models import FiscalDocument, FiscalPayment
from app.models import Comanda, Pagamento


TENANT_A = 880081
TENANT_B = 880082
LINK_CONSTRAINTS = {
    "fk_fiscal_document_comanda_tenant", "fk_fiscal_payment_pagamento_tenant",
}
MIGRATION_PATH = (
    Path(__file__).resolve().parents[1] / "alembic" / "versions"
    / "1370ca2f0151_enforce_fiscal_operational_tenant_links.py"
)


def _metadata(*, previous_schema=False):
    metadata = MetaData()
    Table("restaurantes", metadata, Column("id", Integer, primary_key=True))
    for name in ("comandas", "pagamentos"):
        table = Table(
            name, metadata,
            Column("id", String, primary_key=True),
            Column("restaurante_id", Integer, ForeignKey("restaurantes.id"), nullable=False),
        )
        if not previous_schema:
            table.append_constraint(UniqueConstraint(
                "restaurante_id", "id", name=f"uq_{name}_restaurante_id_id",
            ))
    for model in (FiscalDocument, FiscalPayment):
        table = model.__table__.to_metadata(metadata)
        if previous_schema:
            for constraint in list(table.constraints):
                if constraint.name in LINK_CONSTRAINTS:
                    table.constraints.remove(constraint)
    return metadata


def _seed(connection, metadata):
    connection.execute(insert(metadata.tables["restaurantes"]), [{"id": TENANT_A}, {"id": TENANT_B}])
    for table in ("comandas", "pagamentos"):
        connection.execute(insert(metadata.tables[table]), [
            {"id": f"{table}-a", "restaurante_id": TENANT_A},
            {"id": f"{table}-b", "restaurante_id": TENANT_B},
        ])
    connection.execute(insert(metadata.tables["fiscal_documents"]), [
        {"id": "doc-a", "restaurante_id": TENANT_A, "comanda_id": "comandas-a",
         "idempotency_key": "sale-a", "sale_snapshot": {"amount": "10.00"}},
        {"id": "doc-b", "restaurante_id": TENANT_B, "comanda_id": "comandas-b",
         "idempotency_key": "sale-b", "sale_snapshot": {"amount": "10.00"}},
    ])
    connection.execute(insert(metadata.tables["fiscal_payments"]), {
        "id": "fiscal-pay-a", "restaurante_id": TENANT_A, "document_id": "doc-a",
        "pagamento_id": "pagamentos-a", "payment_order": 1, "tpag": "01", "amount": 10,
    })


@pytest.fixture
def sqlite_links():
    test_engine = create_engine("sqlite:///:memory:")
    @event.listens_for(test_engine, "connect")
    def foreign_keys(dbapi_connection, _record):
        dbapi_connection.execute("PRAGMA foreign_keys=ON")
    metadata = _metadata()
    metadata.create_all(test_engine)
    with test_engine.begin() as connection:
        _seed(connection, metadata)
        yield connection, metadata
    test_engine.dispose()


@pytest.mark.parametrize("table_name,id_field,foreign_id", [
    ("fiscal_documents", "comanda_id", "comandas-b"),
    ("fiscal_payments", "pagamento_id", "pagamentos-b"),
    ("fiscal_payments", "document_id", "doc-b"),
])
def test_cross_tenant_fiscal_link_update_is_blocked_by_sql(sqlite_links, table_name, id_field, foreign_id):
    connection, metadata = sqlite_links
    table = metadata.tables[table_name]
    row_id = "doc-a" if table_name == "fiscal_documents" else "fiscal-pay-a"
    with pytest.raises(IntegrityError), connection.begin_nested():
        connection.execute(update(table).where(table.c.id == row_id).values({id_field: foreign_id}))


def test_own_links_and_nullable_external_links_remain_valid(sqlite_links):
    connection, metadata = sqlite_links
    doc = metadata.tables["fiscal_documents"]
    payment = metadata.tables["fiscal_payments"]
    assert connection.execute(select(doc.c.comanda_id).where(doc.c.id == "doc-a")).scalar_one() == "comandas-a"
    connection.execute(update(doc).where(doc.c.id == "doc-a").values(comanda_id=None))
    connection.execute(update(payment).where(payment.c.id == "fiscal-pay-a").values(pagamento_id=None))
    assert connection.execute(select(doc.c.comanda_id).where(doc.c.id == "doc-a")).scalar_one() is None


@pytest.mark.parametrize("table_name,values", [
    ("fiscal_documents", {"id": "bad-doc", "restaurante_id": TENANT_A,
        "comanda_id": "comandas-b", "idempotency_key": "bad-sale", "sale_snapshot": {"amount": "10.00"}}),
    ("fiscal_payments", {"id": "bad-pay", "restaurante_id": TENANT_A,
        "document_id": "doc-a", "pagamento_id": "pagamentos-b", "payment_order": 2, "tpag": "01", "amount": 10}),
])
def test_cross_tenant_fiscal_link_insert_is_blocked_by_sql(sqlite_links, table_name, values):
    connection, metadata = sqlite_links
    with pytest.raises(IntegrityError), connection.begin_nested():
        connection.execute(insert(metadata.tables[table_name]), values)


@pytest.mark.parametrize("table_name,referenced_id", [("comandas", "comandas-a"), ("pagamentos", "pagamentos-a")])
def test_fiscal_links_restrict_deleting_operational_history(sqlite_links, table_name, referenced_id):
    connection, metadata = sqlite_links
    table = metadata.tables[table_name]
    with pytest.raises(IntegrityError), connection.begin_nested():
        connection.execute(table.delete().where(table.c.id == referenced_id))


def test_operational_parent_metadata_has_composite_keys():
    for model in (Comanda, Pagamento):
        assert any(
            isinstance(constraint, UniqueConstraint)
            and list(constraint.columns.keys()) == ["restaurante_id", "id"]
            for constraint in model.__table__.constraints
        )


def _migration():
    spec = importlib.util.spec_from_file_location("fiscal_tenant_link_migration", MIGRATION_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize("table_name,id_field,foreign_id", [
    ("fiscal_documents", "comanda_id", "comandas-b"),
    ("fiscal_payments", "pagamento_id", "pagamentos-b"),
    ("fiscal_documents", "comanda_id", "missing-comanda"),
    ("fiscal_payments", "pagamento_id", "missing-pagamento"),
])
def test_migration_rejects_existing_foreign_tenant_links_without_rewriting(table_name, id_field, foreign_id):
    # The former schema accepts the bad link; the migration must stop before DDL.
    test_engine = create_engine("sqlite:///:memory:")
    metadata = _metadata(previous_schema=True)
    metadata.create_all(test_engine)
    with test_engine.begin() as connection:
        _seed(connection, metadata)
        table = metadata.tables[table_name]
        row_id = "doc-a" if table_name == "fiscal_documents" else "fiscal-pay-a"
        connection.execute(update(table).where(table.c.id == row_id).values({id_field: foreign_id}))
        with pytest.raises(RuntimeError, match="cross-tenant"):
            with Operations.context(MigrationContext.configure(connection)):
                _migration().upgrade()
        assert connection.execute(select(table.c[id_field]).where(table.c.id == row_id)).scalar_one() == foreign_id
        assert not LINK_CONSTRAINTS.intersection({
            fk["name"] for name in ("fiscal_documents", "fiscal_payments")
            for fk in inspect(connection).get_foreign_keys(name)
        })
    test_engine.dispose()


def test_migration_upgrade_and_downgrade_sqlite():
    test_engine = create_engine("sqlite:///:memory:")
    metadata = _metadata(previous_schema=True)
    metadata.create_all(test_engine)
    migration = _migration()
    with test_engine.begin() as connection:
        _seed(connection, metadata)
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
        assert LINK_CONSTRAINTS <= {
            fk["name"] for name in ("fiscal_documents", "fiscal_payments")
            for fk in inspect(connection).get_foreign_keys(name)
        }
        assert connection.execute(text("SELECT COUNT(*) FROM fiscal_documents")).scalar_one() == 2
        with Operations.context(MigrationContext.configure(connection)):
            migration.downgrade()
        assert not LINK_CONSTRAINTS.intersection({
            fk["name"] for name in ("fiscal_documents", "fiscal_payments")
            for fk in inspect(connection).get_foreign_keys(name)
        })
    test_engine.dispose()


@pytest.fixture
def postgres_links():
    url = os.getenv("KOMA_FISCAL_TENANT_TEST_POSTGRES_URL", "").strip()
    if not url:
        pytest.skip("PostgreSQL local fiscal não configurado")
    parsed = make_url(url)
    if parsed.host not in {"localhost", "127.0.0.1", "::1"}:
        pytest.fail("Teste fiscal PostgreSQL aceita somente banco local efêmero.")
    test_engine = create_engine(url)
    suffix = uuid.uuid4().hex[:12]
    schema, role = f"fiscal_test_{suffix}", f"fiscal_test_role_{suffix}"
    metadata = _metadata(previous_schema=True)
    with test_engine.connect() as connection:
        try:
            connection.execute(text(f"CREATE SCHEMA {schema}"))
            connection.execute(text(f"SET search_path TO {schema}"))
            metadata.create_all(connection)
            _seed(connection, metadata)
            with Operations.context(MigrationContext.configure(connection)):
                _migration().upgrade()
            connection.execute(text(f"CREATE ROLE {role} NOLOGIN NOSUPERUSER NOBYPASSRLS"))
            connection.execute(text(f"GRANT USAGE ON SCHEMA {schema} TO {role}"))
            connection.execute(text(f"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA {schema} TO {role}"))
            for table_name in ("comandas", "pagamentos", "fiscal_documents", "fiscal_payments"):
                connection.execute(text(f"ALTER TABLE {table_name} ENABLE ROW LEVEL SECURITY"))
                connection.execute(text(f"ALTER TABLE {table_name} FORCE ROW LEVEL SECURITY"))
                connection.execute(text(f"""CREATE POLICY tenant_isolation ON {table_name}
                    TO {role}
                    USING (restaurante_id = NULLIF(current_setting('app.current_restaurante_id', true), '')::int)
                    WITH CHECK (restaurante_id = NULLIF(current_setting('app.current_restaurante_id', true), '')::int)"""))
            connection.commit()
            yield connection, role, schema
        finally:
            connection.rollback()
            connection.execute(text("RESET ROLE"))
            connection.execute(text("SET search_path TO public"))
            connection.execute(text(f"DROP SCHEMA IF EXISTS {schema} CASCADE"))
            connection.execute(text(f"DROP ROLE IF EXISTS {role}"))
            connection.commit()
            test_engine.dispose()


def test_postgres_runtime_role_rls_and_composite_links(postgres_links):
    connection, role, _schema = postgres_links
    connection.execute(text(f"SET LOCAL ROLE {role}"))
    connection.execute(text("SELECT set_config('app.current_restaurante_id', :tenant, true)"), {"tenant": str(TENANT_A)})
    assert connection.execute(text("SELECT id FROM fiscal_documents")).scalars().all() == ["doc-a"]
    assert connection.execute(text("SELECT id FROM pagamentos")).scalars().all() == ["pagamentos-a"]
    for statement in (
        "UPDATE fiscal_documents SET comanda_id='comandas-b' WHERE id='doc-a'",
        "UPDATE fiscal_payments SET pagamento_id='pagamentos-b' WHERE id='fiscal-pay-a'",
        "UPDATE fiscal_payments SET document_id='doc-b' WHERE id='fiscal-pay-a'",
    ):
        with pytest.raises(IntegrityError), connection.begin_nested():
            connection.execute(text(statement))
    with pytest.raises(DBAPIError) as denied, connection.begin_nested():
        connection.execute(text("UPDATE fiscal_documents SET restaurante_id=880082 WHERE id='doc-a'"))
    assert getattr(denied.value.orig, "pgcode", None) == "42501"
    assert connection.execute(text("UPDATE fiscal_documents SET comanda_id='comandas-a' WHERE id='doc-a'")).rowcount == 1
    with pytest.raises(IntegrityError), connection.begin_nested():
        connection.execute(insert(FiscalDocument.__table__), {
            "id": "bad-doc", "restaurante_id": TENANT_A, "comanda_id": "comandas-b",
            "idempotency_key": "bad-sale", "sale_snapshot": {"amount": "10.00"},
        })
    connection.rollback()
    connection.execute(text(f"SET LOCAL ROLE {role}"))
    assert connection.execute(text("SELECT id FROM fiscal_documents")).scalars().all() == []
    with pytest.raises(DBAPIError) as denied, connection.begin_nested():
        connection.execute(insert(FiscalDocument.__table__), {
            "id": "missing-scope-doc", "restaurante_id": TENANT_A,
            "idempotency_key": "missing-scope-sale", "sale_snapshot": {"amount": "10.00"},
        })
    assert getattr(denied.value.orig, "pgcode", None) == "42501"
    connection.rollback()


def test_postgres_migration_constraints_are_validated_and_reversible(postgres_links):
    connection, _role, schema = postgres_links
    rows = connection.execute(text("""SELECT conname, convalidated
        FROM pg_constraint WHERE connamespace = CAST(:schema AS regnamespace)
        AND conname IN ('fk_fiscal_document_comanda_tenant','fk_fiscal_payment_pagamento_tenant')"""), {"schema": schema}).all()
    assert len(rows) == 2 and all(row.convalidated for row in rows)
    with Operations.context(MigrationContext.configure(connection)):
        _migration().downgrade()
        _migration().upgrade()
    connection.commit()
