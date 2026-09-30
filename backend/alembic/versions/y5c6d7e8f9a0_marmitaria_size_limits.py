"""Tamanhos de marmita e limites por vínculo de categoria, sem duplicar opções."""
from alembic import op
import sqlalchemy as sa

revision = 'y5c6d7e8f9a0'
down_revision = 'x4b5c6d7e8f9'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('categorias', sa.Column('marmitaria_tamanho', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('categoria_grupo_modificadores', sa.Column('min_selecoes', sa.Integer(), nullable=True))
    op.add_column('categoria_grupo_modificadores', sa.Column('max_selecoes', sa.Integer(), nullable=True))
    op.add_column('categoria_grupo_modificadores', sa.Column('modo_selecao', sa.String(16), nullable=True))

def downgrade():
    op.drop_column('categoria_grupo_modificadores', 'modo_selecao')
    op.drop_column('categoria_grupo_modificadores', 'max_selecoes')
    op.drop_column('categoria_grupo_modificadores', 'min_selecoes')
    op.drop_column('categorias', 'marmitaria_tamanho')
