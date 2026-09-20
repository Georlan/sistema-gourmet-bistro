"""Add operational onboarding capabilities.

Revision ID: m2b3c4d5e6f7
Revises: l1a2b3c4d5e6
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "m2b3c4d5e6f7"
down_revision: Union[str, Sequence[str], None] = "l1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "configuracoes_restaurante",
        sa.Column("operation_capabilities", sa.JSON(), nullable=True),
    )
    op.add_column(
        "configuracoes_restaurante",
        sa.Column("operation_started_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("configuracoes_restaurante", "operation_started_at")
    op.drop_column("configuracoes_restaurante", "operation_capabilities")
