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
    # Check and add columns safely if missing using batch_alter_table for SQLite/Postgres compatibility
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    
    caixa_turnos_cols = [c['name'] for c in inspector.get_columns('caixa_turnos')]
    if 'observacao' not in caixa_turnos_cols:
        with op.batch_alter_table('caixa_turnos') as batch_op:
            batch_op.add_column(sa.Column('observacao', sa.String(), server_default=''))

    caixa_movs_cols = [c['name'] for c in inspector.get_columns('caixa_movimentacoes')]
    with op.batch_alter_table('caixa_movimentacoes') as batch_op:
        if 'restaurante_id' not in caixa_movs_cols:
            batch_op.add_column(sa.Column('restaurante_id', sa.Integer(), nullable=True, index=True))
        if 'usuario_id' not in caixa_movs_cols:
            batch_op.add_column(sa.Column('usuario_id', sa.String(), nullable=True))
        if 'saldo_anterior' not in caixa_movs_cols:
            batch_op.add_column(sa.Column('saldo_anterior', sa.Float(), server_default='0.0'))
        if 'saldo_posterior' not in caixa_movs_cols:
            batch_op.add_column(sa.Column('saldo_posterior', sa.Float(), server_default='0.0'))
        if 'observacao' not in caixa_movs_cols:
            batch_op.add_column(sa.Column('observacao', sa.String(), server_default=''))


def downgrade() -> None:
    pass
