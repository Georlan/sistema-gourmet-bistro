"""Allow a restaurant to choose its menu highlight.

Revision ID: f4d9e1a3b5c7
Revises: f3c8d0e2a4b6
"""
from alembic import op
import sqlalchemy as sa

revision = 'f4d9e1a3b5c7'
down_revision = 'f3c8d0e2a4b6'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('configuracoes_restaurante', sa.Column('destaque_cardapio_produto_id', sa.String(), nullable=True))

def downgrade():
    op.drop_column('configuracoes_restaurante', 'destaque_cardapio_produto_id')
