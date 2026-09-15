"""harden delivery address snapshot tenant isolation

Revision ID: ab41d7c9e205
Revises: f8b5c2d9a1e7
Create Date: 2026-09-15

Adds database-level tenant isolation to the delivery-address snapshot table.
The application already scopes reads and writes by restaurante_id; this
migration makes PostgreSQL fail closed if a future query forgets that filter.
"""

from alembic import op


revision = "ab41d7c9e205"
down_revision = "f8b5c2d9a1e7"
branch_labels = None
depends_on = None


TABLE = "comanda_delivery_address_snapshots"


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

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

    op.execute(f"ALTER TABLE public.{TABLE} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE public.{TABLE} FORCE ROW LEVEL SECURITY")
    op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON public.{TABLE}")
    op.execute(
        f"""
        CREATE POLICY tenant_isolation ON public.{TABLE}
        AS PERMISSIVE
        FOR ALL
        TO koma_app
        USING (restaurante_id = {tenant_expression})
        WITH CHECK (restaurante_id = {tenant_expression})
        """
    )
    op.execute(
        f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.{TABLE} TO koma_app"
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON public.{TABLE}")
    op.execute(f"ALTER TABLE public.{TABLE} NO FORCE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE public.{TABLE} DISABLE ROW LEVEL SECURITY")
    op.execute(
        f"REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE public.{TABLE} FROM koma_app"
    )
