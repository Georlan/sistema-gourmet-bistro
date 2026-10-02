"""add pedido_minimo_retirada to configuracoes_restaurante

Revision ID: z8e9f0a1b2c3
Revises: z7d8e9f0a1b2
Create Date: 2026-10-02 07:30:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector


# revision identifiers, used by Alembic.
revision = 'z8e9f0a1b2c3'
down_revision = 'z7d8e9f0a1b2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)
    if inspector.has_table('configuracoes_restaurante'):
        columns = [c['name'] for c in inspector.get_columns('configuracoes_restaurante')]
        if 'pedido_minimo_retirada' not in columns:
            op.add_column(
                'configuracoes_restaurante',
                sa.Column('pedido_minimo_retirada', sa.Boolean(), nullable=False, server_default=sa.false()),
            )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)
    if inspector.has_table('configuracoes_restaurante'):
        columns = [c['name'] for c in inspector.get_columns('configuracoes_restaurante')]
        if 'pedido_minimo_retirada' in columns:
            op.drop_column('configuracoes_restaurante', 'pedido_minimo_retirada')
