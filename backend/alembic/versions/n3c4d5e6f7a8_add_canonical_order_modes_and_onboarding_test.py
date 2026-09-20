"""Add canonical order modes and explicit onboarding test marker.

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
    # NULL deliberately means "legacy runtime semantics". Existing tenants are
    # not assigned a guessed fulfillment policy during migration.
    op.add_column(
        "configuracoes_restaurante",
        sa.Column("tipos_pedido_ativos", sa.JSON(), nullable=True),
    )
    op.add_column(
        "comandas",
        sa.Column(
            "onboarding_test",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.alter_column("comandas", "onboarding_test", server_default=None)


def downgrade() -> None:
    op.drop_column("comandas", "onboarding_test")
    op.drop_column("configuracoes_restaurante", "tipos_pedido_ativos")
