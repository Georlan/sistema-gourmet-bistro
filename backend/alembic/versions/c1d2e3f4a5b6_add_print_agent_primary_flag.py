"""add print agent primary flag and backfill

Revision ID: c1d2e3f4a5b6
Revises: b4c5d6e7f8a9
Create Date: 2026-10-06

Adiciona is_primary a print_agent_tokens para prioridade determinística
de consumo de PrintJobs normais. Promove o agente Windows do restaurante 6
a principal e o Linux secundário a secundário. Promove tenants com agente
único a principal automaticamente.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c1d2e3f4a5b6"
down_revision: Union[str, Sequence[str], None] = "b4c5d6e7f8a9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    with op.batch_alter_table("print_agent_tokens") as batch:
        batch.add_column(
            sa.Column(
                "is_primary",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            )
        )

    if dialect == "postgresql":
        op.execute("SET LOCAL lock_timeout = '5s'")
        # Backfill para tenants com exatamente 1 agente ativo
        op.execute(
            """
            WITH single_active AS (
                SELECT restaurante_id, min(id) as target_id
                FROM print_agent_tokens
                WHERE ativo = true
                GROUP BY restaurante_id
                HAVING count(*) = 1
            )
            UPDATE print_agent_tokens
            SET is_primary = true
            FROM single_active
            WHERE print_agent_tokens.id = single_active.target_id;
            """
        )
        # Proteção determinística para o restaurante 6:
        # A máquina física Windows (desktop-cEr5H5uJyd1p) é a principal em produção.
        # O Linux de desenvolvimento/suporte (desktop-x60XJGn-1DCo) é secundário.
        op.execute(
            """
            UPDATE print_agent_tokens
            SET is_primary = true
            WHERE restaurante_id = 6 AND agent_id = 'desktop-cEr5H5uJyd1p';
            """
        )
        op.execute(
            """
            UPDATE print_agent_tokens
            SET is_primary = false
            WHERE restaurante_id = 6 AND agent_id = 'desktop-x60XJGn-1DCo';
            """
        )


def downgrade() -> None:
    with op.batch_alter_table("print_agent_tokens") as batch:
        batch.drop_column("is_primary")
