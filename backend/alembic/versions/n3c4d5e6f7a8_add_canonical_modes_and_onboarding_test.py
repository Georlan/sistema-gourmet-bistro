"""Add canonical fulfillment modes and onboarding test-order marker.

Revision ID: n3c4d5e6f7a8
Revises: l1a2b3c4d5e6
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "n3c4d5e6f7a8"
down_revision: Union[str, Sequence[str], None] = "l1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "configuracoes_restaurante",
        sa.Column("tipos_pedido_ativos", sa.JSON(), nullable=True),
    )
    op.add_column(
        "comandas",
        sa.Column(
            "onboarding_test",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_comandas_onboarding_test",
        "comandas",
        ["onboarding_test"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_comandas_onboarding_test", table_name="comandas")
    op.drop_column("comandas", "onboarding_test")
    op.drop_column("configuracoes_restaurante", "tipos_pedido_ativos")
