"""add context_metadata column to customer_support_feedback

Revision ID: 20261124c101
Revises: 20261124b11a
Create Date: 2026-11-24
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261124c101"
down_revision: Union[str, Sequence[str], None] = "20261124b11a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "customer_support_feedback" not in inspector.get_table_names():
        return
    columns = {col["name"] for col in inspector.get_columns("customer_support_feedback")}
    if "context_metadata" not in columns:
        op.add_column(
            "customer_support_feedback",
            sa.Column("context_metadata", sa.JSON(), nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "customer_support_feedback" not in inspector.get_table_names():
        return
    columns = {col["name"] for col in inspector.get_columns("customer_support_feedback")}
    if "context_metadata" in columns:
        op.drop_column("customer_support_feedback", "context_metadata")
