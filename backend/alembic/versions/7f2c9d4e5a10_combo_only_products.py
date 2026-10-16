"""Produtos exclusivos de promoções mantêm estoque e identidade canônica.

Revision ID: 7f2c9d4e5a10
Revises: 4d7e9f20b513
"""
from alembic import op
import sqlalchemy as sa

revision = "7f2c9d4e5a10"
down_revision = "4d7e9f20b513"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("produtos") as batch:
        batch.add_column(sa.Column(
            "somente_promocao", sa.Boolean(), nullable=False,
            server_default=sa.false(),
        ))


def downgrade() -> None:
    with op.batch_alter_table("produtos") as batch:
        batch.drop_column("somente_promocao")
