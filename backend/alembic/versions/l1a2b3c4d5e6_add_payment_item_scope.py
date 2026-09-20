"""Persist item scope on payments.

Revision ID: l1a2b3c4d5e6
Revises: k0f1a2b3c4d5
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "l1a2b3c4d5e6"
down_revision: Union[str, Sequence[str], None] = "k0f1a2b3c4d5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("pagamentos", sa.Column("item_ids", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("pagamentos", "item_ids")
