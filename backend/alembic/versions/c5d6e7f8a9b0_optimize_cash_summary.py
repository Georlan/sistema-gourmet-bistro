"""optimize and protect the tenant-scoped cash summary

Revision ID: c5d6e7f8a9b0
Revises: b3c4d5e6f7a8
Create Date: 2026-08-11 02:20:00.000000
"""
from typing import Sequence, Union

from alembic import op


revision: str = "c5d6e7f8a9b0"
down_revision: Union[str, Sequence[str], None] = "b3c4d5e6f7a8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_caixa_turnos_tenant_open
        ON public.caixa_turnos (restaurante_id)
        WHERE status = 'aberto'
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_pagamentos_tenant_turno_aprovado_metodo
        ON public.pagamentos (restaurante_id, turno_id, metodo)
        INCLUDE (valor, comanda_id)
        WHERE status = 'aprovado'
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_caixa_movimentacoes_tenant_turno_tipo
        ON public.caixa_movimentacoes (restaurante_id, turno_id, tipo)
        INCLUDE (valor)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_caixa_movimentacoes_tenant_turno_latest
        ON public.caixa_movimentacoes (restaurante_id, turno_id, criado_em DESC, id DESC)
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS public.ix_caixa_movimentacoes_tenant_turno_latest")
    op.execute("DROP INDEX IF EXISTS public.ix_caixa_movimentacoes_tenant_turno_tipo")
    op.execute("DROP INDEX IF EXISTS public.ix_pagamentos_tenant_turno_aprovado_metodo")
    op.execute("DROP INDEX IF EXISTS public.uq_caixa_turnos_tenant_open")
