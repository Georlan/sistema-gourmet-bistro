"""force row level security on remaining tenant tables

Revision ID: a0b1c2d3e4f5
Revises: f9a0b1c2d3e4
Create Date: 2026-08-16 09:30:00.000000

Fecha a diferença entre ENABLE RLS e FORCE RLS nas tabelas criadas pelas
etapas mais recentes. As políticas tenant_isolation existentes são preservadas.
"""
from typing import Sequence, Union

from alembic import op


revision: str = "a0b1c2d3e4f5"
down_revision: Union[str, Sequence[str], None] = "f9a0b1c2d3e4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TENANT_TABLES = (
    "numeradores_operacionais",
    "atendimentos_mesa",
    "atendimento_comandas",
    "lancamento_identidades",
    "movimentos_atendimento",
    "motoboy_tokens_ativos",
)


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    for table in TENANT_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    for table in TENANT_TABLES:
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
