"""optimize the tenant-scoped active orders refresh

Revision ID: b3c4d5e6f7a8
Revises: a2b3c4d5e6f7
Create Date: 2026-08-10 18:20:00.000000
"""
from typing import Sequence, Union

from alembic import op


revision: str = "b3c4d5e6f7a8"
down_revision: Union[str, Sequence[str], None] = "a2b3c4d5e6f7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_comandas_tenant_open_created
        ON public.comandas (restaurante_id, criado_em, id)
        WHERE fechada = false
    """)


def downgrade() -> None:
    op.execute(
        "DROP INDEX IF EXISTS public.ix_comandas_tenant_open_created"
    )
