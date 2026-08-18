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


RESTAURANTE_WHITELABEL_COLUMNS = (
    ('slug', sa.String()),
    ('logo_url', sa.String()),
    ('banner_url', sa.String()),
    ('subtitulo', sa.String()),
    ('sobre_nos', sa.String()),
    ('endereco', sa.String()),
    ('google_maps_url', sa.String()),
    ('latitude', sa.Float()),
    ('longitude', sa.Float()),
    ('status_override', sa.String()),
    ('socials', sa.JSON()),
    ('horarios_funcionamento', sa.JSON()),
    ('formas_pagamento_aceitas', sa.JSON()),
    ('cor_primaria', sa.String()),
    ('cor_fundo', sa.String()),
)


def upgrade() -> None:
    """Materializa o contrato white-label e a chave composta de clientes."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # ─── ALTERAÇÕES NA TABELA: restaurantes ───────────────────
    # Bancos antigos podiam ter recebido parte destes campos pelo bootstrap
    # ORM. A migration deve ser idempotente em relação a esse estado legado e
    # também construir sozinha um PostgreSQL vazio.
    if inspector.has_table('restaurantes'):
        existing_cols = {c['name'] for c in inspector.get_columns('restaurantes')}
        with op.batch_alter_table('restaurantes') as batch_op:
            for col_name, col_type in RESTAURANTE_WHITELABEL_COLUMNS:
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
    bind = op.get_bind()
    if sa.inspect(bind).has_table('restaurantes'):
        existing_cols = {c['name'] for c in sa.inspect(bind).get_columns('restaurantes')}
        with op.batch_alter_table('restaurantes') as batch_op:
            for col_name, _ in reversed(RESTAURANTE_WHITELABEL_COLUMNS):
                if col_name in existing_cols:
                    batch_op.drop_column(col_name)

    op.drop_table('clientes')
    op.create_table(
        'clientes',
        sa.Column('telefone', sa.String(), primary_key=True),
        sa.Column('nome', sa.String(), nullable=False),
        sa.Column('criado_em', sa.DateTime(), nullable=False)
    )
