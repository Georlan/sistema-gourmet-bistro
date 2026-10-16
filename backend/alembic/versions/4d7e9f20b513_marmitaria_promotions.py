"""Ofertas de produtos canônicos por restaurante (desativadas por padrão).

Revision ID: 4d7e9f20b513
Revises: 3c6e8f21a409
"""
from alembic import op
import sqlalchemy as sa

revision = "4d7e9f20b513"
down_revision = "3c6e8f21a409"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("configuracoes_restaurante") as batch:
        batch.add_column(sa.Column("promocoes", sa.JSON(), nullable=False, server_default=sa.text("'[]'")))


def downgrade() -> None:
    with op.batch_alter_table("configuracoes_restaurante") as batch:
        batch.drop_column("promocoes")
