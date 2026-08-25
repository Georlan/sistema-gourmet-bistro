"""harden product recipe tenant policy for already migrated databases

Revision ID: 5b6c7d8e9f0a
Revises: 4a5b6c7d8e9f
Create Date: 2026-08-25 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = "5b6c7d8e9f0a"
down_revision: Union[str, Sequence[str], None] = "4a5b6c7d8e9f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    op.execute("ALTER TABLE public.produto_insumos ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.produto_insumos FORCE ROW LEVEL SECURITY")
    op.execute(
        "DROP POLICY IF EXISTS tenant_isolation ON public.produto_insumos"
    )
    op.execute(
        """
        CREATE POLICY tenant_isolation ON public.produto_insumos
        AS PERMISSIVE
        FOR ALL
        TO koma_app
        USING (
            restaurante_id = NULLIF(
                (SELECT current_setting('app.current_restaurante_id', true)),
                ''
            )::integer
        )
        WITH CHECK (
            restaurante_id = NULLIF(
                (SELECT current_setting('app.current_restaurante_id', true)),
                ''
            )::integer
        )
        """
    )
    op.execute(
        "GRANT SELECT, INSERT, UPDATE, DELETE "
        "ON TABLE public.produto_insumos TO koma_app"
    )
    op.execute(
        "GRANT USAGE, SELECT "
        "ON SEQUENCE public.produto_insumos_id_seq TO koma_app"
    )


def downgrade() -> None:
    # The previous revision now contains the same hardened policy. Keeping it
    # avoids turning a rollback into a temporary tenant-isolation regression.
    pass
