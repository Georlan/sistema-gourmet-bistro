"""expand caixa_turnos and caixa_movimentacoes columns for operational turn control

Revision ID: e8d7c6b5a4f3
Revises: f9e8d7c6b5a4
Create Date: 2026-07-22 03:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'e8d7c6b5a4f3'
down_revision: Union[str, Sequence[str], None] = 'f9e8d7c6b5a4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Check and add columns safely if missing
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    
    caixa_turnos_cols = [c['name'] for c in inspector.get_columns('caixa_turnos')]
    if 'observacao' not in caixa_turnos_cols:
        op.add_column('caixa_turnos', sa.Column('observacao', sa.String(), server_default=''))

    caixa_movs_cols = [c['name'] for c in inspector.get_columns('caixa_movimentacoes')]
    if 'restaurante_id' not in caixa_movs_cols:
        op.add_column('caixa_movimentacoes', sa.Column('restaurante_id', sa.Integer(), sa.ForeignKey('restaurantes.id'), nullable=True, index=True))
    if 'usuario_id' not in caixa_movs_cols:
        op.add_column('caixa_movimentacoes', sa.Column('usuario_id', sa.String(), sa.ForeignKey('usuarios.id'), nullable=True))
    if 'saldo_anterior' not in caixa_movs_cols:
        op.add_column('caixa_movimentacoes', sa.Column('saldo_anterior', sa.Float(), server_default='0.0'))
    if 'saldo_posterior' not in caixa_movs_cols:
        op.add_column('caixa_movimentacoes', sa.Column('saldo_posterior', sa.Float(), server_default='0.0'))
    if 'observacao' not in caixa_movs_cols:
        op.add_column('caixa_movimentacoes', sa.Column('observacao', sa.String(), server_default=''))


def downgrade() -> None:
    pass
