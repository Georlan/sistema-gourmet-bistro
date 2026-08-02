"""normalize motoboy token RLS InitPlan expression

Revision ID: d0e1f2a3b4c5
Revises: c9d0e1f2a3b4
Create Date: 2026-08-02 14:30:00.000000

Keep only ``current_setting`` inside the scalar subquery, matching the
InitPlan form already used by the remaining tenant policies and recognized
by the Supabase database advisor.
"""
from typing import Sequence, Union

from alembic import op


revision: str = "d0e1f2a3b4c5"
down_revision: Union[str, Sequence[str], None] = "c9d0e1f2a3b4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_TENANT_EXPRESSION = """
    NULLIF(
        (
            SELECT current_setting(
                'app.current_restaurante_id', true
            )
        ),
        ''
    )::integer
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
        USING (restaurante_id = {_TENANT_EXPRESSION})
        WITH CHECK (restaurante_id = {_TENANT_EXPRESSION})
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
            restaurante_id = (
                SELECT NULLIF(
                    current_setting(
                        'app.current_restaurante_id', true
                    ),
                    ''
                )::integer
            )
        )
        WITH CHECK (
            restaurante_id = (
                SELECT NULLIF(
                    current_setting(
                        'app.current_restaurante_id', true
                    ),
                    ''
                )::integer
            )
        )
    """)
