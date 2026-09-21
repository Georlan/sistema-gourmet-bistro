"""add customer phone verification timestamp

Revision ID: k0f1a2b3c4d5
Revises: j9e0f1a2b3c4
"""

from alembic import op
import sqlalchemy as sa


revision = "k0f1a2b3c4d5"
down_revision = "j9e0f1a2b3c4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "clientes",
        sa.Column("telefone_verificado_em", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("clientes", "telefone_verificado_em")
