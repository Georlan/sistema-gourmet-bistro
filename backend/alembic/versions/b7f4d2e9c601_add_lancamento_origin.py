"""add operational origin to order launches

Revision ID: b7f4d2e9c601
Revises: a3e5c7f9b124
Create Date: 2026-08-19
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b7f4d2e9c601"
down_revision: Union[str, Sequence[str], None] = "a3e5c7f9b124"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_ALLOWED_ORIGINS = "'desconhecida', 'garcom', 'caixa', 'smartpos', 'cardapio'"


def upgrade() -> None:
    with op.batch_alter_table("lancamentos") as batch_op:
        batch_op.add_column(
            sa.Column(
                "origem",
                sa.String(length=24),
                nullable=False,
                server_default="desconhecida",
            )
        )
        batch_op.create_check_constraint(
            "ck_lancamentos_origem",
            f"origem IN ({_ALLOWED_ORIGINS})",
        )


def downgrade() -> None:
    with op.batch_alter_table("lancamentos") as batch_op:
        batch_op.drop_constraint("ck_lancamentos_origem", type_="check")
        batch_op.drop_column("origem")
