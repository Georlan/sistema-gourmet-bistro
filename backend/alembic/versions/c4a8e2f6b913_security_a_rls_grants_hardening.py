"""security A: normalize tenant RLS and remove unsafe PUBLIC grants

Revision ID: c4a8e2f6b913
Revises: b7f4d2e9c601
Create Date: 2026-08-19

This migration closes the database-isolation findings reproduced by the
five-tenant adversarial audit:

* every table carrying ``restaurante_id`` gets ENABLE + FORCE RLS;
* the canonical tenant policy is recreated for ``koma_app`` only;
* a missing/empty tenant GUC fails closed instead of raising on ``''::int``;
* legacy PUBLIC privileges on ``clientes`` and ``comandas`` are removed.

Intentional public-menu policies are preserved because only the canonical
``tenant_isolation`` policy is replaced.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c4a8e2f6b913"
down_revision: Union[str, Sequence[str], None] = "b7f4d2e9c601"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


LEGACY_PUBLIC_TABLES: tuple[str, ...] = (
    "clientes",
    "comandas",
)


def _quote(bind, identifier: str) -> str:
    return bind.dialect.identifier_preparer.quote(identifier)


def _tenant_tables(bind) -> list[str]:
    rows = bind.execute(
        sa.text(
            """
            SELECT DISTINCT table_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND column_name = 'restaurante_id'
            ORDER BY table_name
            """
        )
    )
    return [row[0] for row in rows]


def _harden_tenant_table(bind, table: str) -> None:
    quoted = _quote(bind, table)
    tenant_expression = """
        NULLIF(
            (
                SELECT current_setting(
                    'app.current_restaurante_id',
                    true
                )
            ),
            ''
        )::integer
    """

    op.execute(f"ALTER TABLE public.{quoted} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE public.{quoted} FORCE ROW LEVEL SECURITY")
    op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON public.{quoted}")
    op.execute(
        f"""
        CREATE POLICY tenant_isolation ON public.{quoted}
        AS PERMISSIVE
        FOR ALL
        TO koma_app
        USING (restaurante_id = {tenant_expression})
        WITH CHECK (restaurante_id = {tenant_expression})
        """
    )

    # Late-created tenant tables must not depend only on default privileges.
    # Keep the runtime role explicit and least-privileged.
    op.execute(
        f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.{quoted} TO koma_app"
    )


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute("SET LOCAL statement_timeout = '2min'")

    for table in _tenant_tables(bind):
        _harden_tenant_table(bind, table)

    # These grants predate the tenant-hardening model. In particular,
    # TRUNCATE is not row-filtered by RLS, so PUBLIC must never inherit it.
    for table in LEGACY_PUBLIC_TABLES:
        op.execute(
            f"REVOKE ALL PRIVILEGES ON TABLE public.{_quote(bind, table)} FROM PUBLIC"
        )

    # Preserve the forward security defaults for future objects. PostgreSQL
    # does not grant table DML to PUBLIC by default; this explicitly prevents
    # accidental reintroduction by a future default-privilege change.
    op.execute(
        """
        ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
        REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER,
        MAINTAIN ON TABLES FROM PUBLIC
        """
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    # Security hardening is intentionally forward-only. Alembic may move the
    # revision marker backwards for compatibility tests, but a downgrade must
    # not recreate cross-tenant exposure or PUBLIC TRUNCATE privileges.
    return
