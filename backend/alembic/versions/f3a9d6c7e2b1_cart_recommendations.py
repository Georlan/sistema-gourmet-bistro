"""Optional tenant-curated cart recommendations.

Revision ID: f3a9d6c7e2b1
Revises: f2b7c9d1e3a5
"""
from alembic import op
import sqlalchemy as sa

revision = "f3a9d6c7e2b1"
down_revision = "f2b7c9d1e3a5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("configuracoes_restaurante", sa.Column("recomendacoes_sacola_ids", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("configuracoes_restaurante", "recomendacoes_sacola_ids")
