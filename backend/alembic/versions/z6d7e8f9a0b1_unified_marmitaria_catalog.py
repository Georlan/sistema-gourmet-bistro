"""Identidade única do tamanho e composição por produto, sem converter dados."""
from alembic import op
import sqlalchemy as sa

revision = 'z6d7e8f9a0b1'
down_revision = 'y5c6d7e8f9a0'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('produtos') as batch:
        batch.add_column(sa.Column('marmitaria_tamanho', sa.String(100), nullable=True))
        batch.create_unique_constraint('uq_produtos_tenant_marmitaria_tamanho', ['restaurante_id', 'marmitaria_tamanho'])
    for column in [sa.Column('min_selecoes', sa.Integer(), nullable=True),
                   sa.Column('max_selecoes', sa.Integer(), nullable=True),
                   sa.Column('modo_selecao', sa.String(16), nullable=True)]:
        op.add_column('produto_grupo_modificadores', column)


def downgrade():
    for column in ['modo_selecao', 'max_selecoes', 'min_selecoes']:
        op.drop_column('produto_grupo_modificadores', column)
    with op.batch_alter_table('produtos') as batch:
        batch.drop_constraint('uq_produtos_tenant_marmitaria_tamanho', type_='unique')
        batch.drop_column('marmitaria_tamanho')
