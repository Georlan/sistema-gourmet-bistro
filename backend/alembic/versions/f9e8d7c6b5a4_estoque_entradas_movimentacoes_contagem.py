"""create stock expansion tables (entradas, movimentacoes, contagens) with multi-tenant RLS policies

Revision ID: f9e8d7c6b5a4
Revises: c3d4e5f6a7b8
Create Date: 2026-07-22 02:30:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'f9e8d7c6b5a4'
down_revision: Union[str, Sequence[str], None] = 'c3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Create tables
    op.create_table(
        'entradas_estoque',
        sa.Column('id', sa.String(), nullable=False, primary_key=True),
        sa.Column('restaurante_id', sa.Integer(), sa.ForeignKey('restaurantes.id'), nullable=False, index=True),
        sa.Column('distribuidor_id', sa.String(), sa.ForeignKey('distribuidores.id'), nullable=True),
        sa.Column('numero_documento', sa.String(), nullable=True),
        sa.Column('data_emissao', sa.String(), nullable=True),
        sa.Column('observacao', sa.String(), server_default=''),
        sa.Column('valor_total', sa.Float(), server_default='0.0'),
        sa.Column('tipo_entrada', sa.String(), server_default='MANUAL'),
        sa.Column('usuario_id', sa.String(), sa.ForeignKey('usuarios.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'))
    )

    op.create_table(
        'itens_entrada_estoque',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False, primary_key=True),
        sa.Column('restaurante_id', sa.Integer(), sa.ForeignKey('restaurantes.id'), nullable=False, index=True),
        sa.Column('entrada_id', sa.String(), sa.ForeignKey('entradas_estoque.id'), nullable=False),
        sa.Column('insumo_id', sa.String(), sa.ForeignKey('insumos.id'), nullable=False),
        sa.Column('quantidade', sa.Float(), nullable=False),
        sa.Column('unidade_medida', sa.String(), server_default='un'),
        sa.Column('custo_unitario', sa.Float(), nullable=False),
        sa.Column('subtotal', sa.Float(), nullable=False)
    )

    op.create_table(
        'movimentacoes_estoque',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False, primary_key=True),
        sa.Column('restaurante_id', sa.Integer(), sa.ForeignKey('restaurantes.id'), nullable=False, index=True),
        sa.Column('insumo_id', sa.String(), sa.ForeignKey('insumos.id'), nullable=False, index=True),
        sa.Column('tipo', sa.String(), nullable=False, index=True),
        sa.Column('quantidade', sa.Float(), nullable=False),
        sa.Column('saldo_anterior', sa.Float(), nullable=False),
        sa.Column('saldo_posterior', sa.Float(), nullable=False),
        sa.Column('custo_unitario', sa.Float(), server_default='0.0'),
        sa.Column('motivo', sa.String(), nullable=False),
        sa.Column('observacao', sa.String(), server_default=''),
        sa.Column('origem', sa.String(), server_default='movimentacao_manual'),
        sa.Column('referencia_id', sa.String(), nullable=True),
        sa.Column('usuario_id', sa.String(), sa.ForeignKey('usuarios.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'))
    )

    op.create_table(
        'sessoes_contagem_estoque',
        sa.Column('id', sa.String(), nullable=False, primary_key=True),
        sa.Column('restaurante_id', sa.Integer(), sa.ForeignKey('restaurantes.id'), nullable=False, index=True),
        sa.Column('status', sa.String(), server_default='rascunho', nullable=False, index=True),
        sa.Column('observacao', sa.String(), server_default=''),
        sa.Column('usuario_id', sa.String(), sa.ForeignKey('usuarios.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('confirmada_em', sa.DateTime(timezone=True), nullable=True)
    )

    op.create_table(
        'itens_contagem_estoque',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False, primary_key=True),
        sa.Column('restaurante_id', sa.Integer(), sa.ForeignKey('restaurantes.id'), nullable=False, index=True),
        sa.Column('contagem_id', sa.String(), sa.ForeignKey('sessoes_contagem_estoque.id'), nullable=False),
        sa.Column('insumo_id', sa.String(), sa.ForeignKey('insumos.id'), nullable=False),
        sa.Column('quantidade_sistema', sa.Float(), nullable=False),
        sa.Column('quantidade_contada', sa.Float(), nullable=False),
        sa.Column('diferenca', sa.Float(), nullable=False),
        sa.Column('ajustado', sa.Boolean(), server_default='false')
    )

    # 2. Enable RLS for PostgreSQL
    conn = op.get_bind()
    if conn.dialect.name == "postgresql":
        tables = [
            'entradas_estoque',
            'itens_entrada_estoque',
            'movimentacoes_estoque',
            'sessoes_contagem_estoque',
            'itens_contagem_estoque'
        ]
        for tbl in tables:
            op.execute(f"ALTER TABLE {tbl} ENABLE ROW LEVEL SECURITY;")
            op.execute(f"""
                CREATE POLICY tenant_isolation ON {tbl}
                FOR ALL
                USING (restaurante_id = current_setting('app.current_restaurante_id', true)::integer)
                WITH CHECK (restaurante_id = current_setting('app.current_restaurante_id', true)::integer);
            """)


def downgrade() -> None:
    conn = op.get_bind()
    if conn.dialect.name == "postgresql":
        tables = [
            'itens_contagem_estoque',
            'sessoes_contagem_estoque',
            'movimentacoes_estoque',
            'itens_entrada_estoque',
            'entradas_estoque'
        ]
        for tbl in tables:
            op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {tbl};")
            op.execute(f"ALTER TABLE {tbl} DISABLE ROW LEVEL SECURITY;")

    op.drop_table('itens_contagem_estoque')
    op.drop_table('sessoes_contagem_estoque')
    op.drop_table('movimentacoes_estoque')
    op.drop_table('itens_entrada_estoque')
    op.drop_table('entradas_estoque')
