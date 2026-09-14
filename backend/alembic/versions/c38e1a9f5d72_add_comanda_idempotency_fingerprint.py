"""add comanda idempotency fingerprint

Revision ID: c38e1a9f5d72
Revises: a27d9e1f3b56
Create Date: 2026-09-14
"""

from alembic import op
import sqlalchemy as sa


revision = "c38e1a9f5d72"
down_revision = "a27d9e1f3b56"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("comandas") as batch_op:
        batch_op.add_column(
            sa.Column("idempotency_fingerprint", sa.String(length=64), nullable=True)
        )
        batch_op.add_column(
            sa.Column("idempotency_fingerprint_version", sa.SmallInteger(), nullable=True)
        )


def downgrade() -> None:
    with op.batch_alter_table("comandas") as batch_op:
        batch_op.drop_column("idempotency_fingerprint_version")
        batch_op.drop_column("idempotency_fingerprint")
