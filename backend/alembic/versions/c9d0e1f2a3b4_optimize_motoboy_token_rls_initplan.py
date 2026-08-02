"""optimize motoboy token RLS tenant lookup

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
Create Date: 2026-08-02 14:00:00.000000

Wrapping ``current_setting`` in a scalar subquery makes PostgreSQL evaluate
the tenant lookup once per statement (InitPlan), instead of once per row.
``NULLIF`` also keeps a missing or empty tenant context fail-closed.
"""
from typing import Sequence, Union

from alembic import op


revision: str = "c9d0e1f2a3b4"
down_revision: Union[str, Sequence[str], None] = "b8c9d0e1f2a3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_OPTIMIZED_TENANT_EXPRESSION = """
    (
        SELECT NULLIF(
            current_setting('app.current_restaurante_id', true),
            ''
        )::integer
    )
"""


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    op.execute(
        "DROP POLICY IF EXISTS tenant_isolation "
        "ON public.motoboy_tokens_ativos"
    )
    op.execute(f"""
        CREATE POLICY tenant_isolation
        ON public.motoboy_tokens_ativos
        AS PERMISSIVE
        FOR ALL
        TO PUBLIC
        USING (restaurante_id = {_OPTIMIZED_TENANT_EXPRESSION})
        WITH CHECK (restaurante_id = {_OPTIMIZED_TENANT_EXPRESSION})
    """)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    op.execute(
        "DROP POLICY IF EXISTS tenant_isolation "
        "ON public.motoboy_tokens_ativos"
    )
    op.execute("""
        CREATE POLICY tenant_isolation
        ON public.motoboy_tokens_ativos
        AS PERMISSIVE
        FOR ALL
        TO PUBLIC
        USING (
            restaurante_id = current_setting(
                'app.current_restaurante_id', true
            )::integer
        )
        WITH CHECK (
            restaurante_id = current_setting(
                'app.current_restaurante_id', true
            )::integer
        )
    """)
