"""add_whitelabel_and_composed_client_key

Revision ID: 5759156260b2
Revises: 4de38de3c004
Create Date: 2026-07-15 12:21:16.333936

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5759156260b2'
down_revision: Union[str, Sequence[str], None] = '4de38de3c004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # ─── ALTERAÇÕES NA TABELA: restaurantes ───────────────────
    if inspector.has_table('restaurantes'):
        existing_cols = {c['name'] for c in inspector.get_columns('restaurantes')}
        with op.batch_alter_table('restaurantes') as batch_op:
            for col_name, col_type in [
                ('slug', sa.String()),
                ('subtitulo', sa.String()),
                ('google_maps_url', sa.String()),
                ('latitude', sa.Float()),
                ('longitude', sa.Float()),
                ('socials', sa.JSON()),
                ('horarios_funcionamento', sa.JSON()),
                ('formas_pagamento_aceitas', sa.JSON())
            ]:
                if col_name not in existing_cols:
                    batch_op.add_column(sa.Column(col_name, col_type, nullable=True))

    # ─── RECRIAÇÃO DA TABELA: clientes (para suporte a UUID e UniqueConstraint composta) ───
    if inspector.has_table('clientes'):
        op.drop_table('clientes')

    op.create_table(
        'clientes',
        sa.Column('id', sa.String(length=36), primary_key=True),
        sa.Column('restaurante_id', sa.Integer(), sa.ForeignKey('restaurantes.id'), nullable=False),
        sa.Column('telefone', sa.String(), nullable=False),
        sa.Column('nome', sa.String(), nullable=False),
        sa.Column('endereco', sa.String(), nullable=True),
        sa.Column('saldo_pontos', sa.Integer(), server_default='0', nullable=False),
        sa.Column('saldo_cashback', sa.Float(), server_default='0.0', nullable=False),
        sa.Column('criado_em', sa.DateTime(), nullable=False),
        sa.UniqueConstraint('restaurante_id', 'telefone', name='uq_restaurante_cliente_telefone')
    )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('restaurantes') as batch_op:
        batch_op.drop_column('slug')
        batch_op.drop_column('subtitulo')
        batch_op.drop_column('google_maps_url')
        batch_op.drop_column('latitude')
        batch_op.drop_column('longitude')
        batch_op.drop_column('socials')
        batch_op.drop_column('horarios_funcionamento')
        batch_op.drop_column('formas_pagamento_aceitas')

    op.drop_table('clientes')
    op.create_table(
        'clientes',
        sa.Column('telefone', sa.String(), primary_key=True),
        sa.Column('nome', sa.String(), nullable=False),
        sa.Column('criado_em', sa.DateTime(), nullable=False)
    )
