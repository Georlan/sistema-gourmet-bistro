"""optimize tenant cash movement history

Revision ID: d6e7f8a9b0c1
Revises: c5d6e7f8a9b0
Create Date: 2026-08-11 06:10:00.000000
"""
from typing import Sequence, Union

from alembic import op


revision: str = "d6e7f8a9b0c1"
down_revision: Union[str, Sequence[str], None] = "c5d6e7f8a9b0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_caixa_movimentacoes_tenant_created_latest
        ON public.caixa_movimentacoes (restaurante_id, criado_em DESC, id DESC)
        INCLUDE (turno_id, usuario_id, tipo, valor, saldo_anterior, saldo_posterior)
    """)


def downgrade() -> None:
    op.execute(
        "DROP INDEX IF EXISTS public.ix_caixa_movimentacoes_tenant_created_latest"
    )
