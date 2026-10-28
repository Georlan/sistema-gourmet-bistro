"""Allow additional operational menus without changing existing publication.

Revision ID: ef947a23bc81
Revises: a1b2c3d4e5f7
"""
from alembic import op
import sqlalchemy as sa

revision = "ef947a23bc81"
down_revision = "a1b2c3d4e5f7"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("configuracoes_restaurante", sa.Column("cardapios_adicionais_ids", sa.JSON(), nullable=True))

def downgrade():
    op.drop_column("configuracoes_restaurante", "cardapios_adicionais_ids")
