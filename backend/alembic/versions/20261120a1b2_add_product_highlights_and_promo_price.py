"""Add showcase highlight, badge and promotional price columns to produtos.

Revision ID: 20261120a1b2
Revises: 20261115c1a1
"""
from alembic import op
import sqlalchemy as sa

revision = "20261120a1b2"
down_revision = "20261115c1a1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("produtos") as batch:
        batch.add_column(
            sa.Column(
                "destaque",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )
        batch.add_column(
            sa.Column(
                "selo",
                sa.String(length=32),
                nullable=True,
            )
        )
        batch.add_column(
            sa.Column(
                "preco_promocional",
                sa.Numeric(precision=14, scale=2),
                nullable=True,
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("produtos") as batch:
        batch.drop_column("preco_promocional")
        batch.drop_column("selo")
        batch.drop_column("destaque")
