"""add_multitenant_unique_constraints

Revision ID: b1c2d3e4f5a6
Revises: a9b8c7d6e5f4
Create Date: 2026-07-22 18:51:00.000000

Migration da Fase 4: 
1. Adiciona coluna restaurante_id em observacoes_predefinidas (multitenant isolation)
2. Transforma unicidade de Categoria.nome em composite unique por tenant (restaurante_id, nome)
   para permitir que múltiplos restaurantes possuam categorias com o mesmo nome sem colisão no banco.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b1c2d3e4f5a6'
down_revision: Union[str, Sequence[str], None] = 'a9b8c7d6e5f4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # 1. Adicionar restaurante_id em observacoes_predefinidas
    obs_cols = [c['name'] for c in inspector.get_columns('observacoes_predefinidas')]
    if 'restaurante_id' not in obs_cols:
        with op.batch_alter_table('observacoes_predefinidas') as batch_op:
            batch_op.add_column(sa.Column('restaurante_id', sa.Integer(), nullable=True, index=True))
        
        # Backfill restaurante_id = 1 para registros legados
        try:
            bind.execute(sa.text("UPDATE observacoes_predefinidas SET restaurante_id = 1 WHERE restaurante_id IS NULL"))
        except Exception as e:
            print(f"⚠️ Backfill observacoes_predefinidas ignorado: {e}")

    # 2. Remover unique constraint global antigo em categorias.nome (se existir) e adicionar composite (restaurante_id, nome)
    cat_indexes = {idx['name'] for idx in inspector.get_indexes('categorias')}
    if 'uq_categorias_nome' in cat_indexes or 'categorias_nome_key' in cat_indexes:
        try:
            with op.batch_alter_table('categorias') as batch_op:
                batch_op.drop_constraint('categorias_nome_key', type_='unique')
        except Exception as e:
            print(f"⚠️ Drop constraint categorias_nome_key ignorado: {e}")

    if 'uq_categorias_restaurante_nome' not in cat_indexes:
        try:
            with op.batch_alter_table('categorias') as batch_op:
                batch_op.create_unique_constraint('uq_categorias_restaurante_nome', ['restaurante_id', 'nome'])
            print("✅ Unique constraint uq_categorias_restaurante_nome criado com sucesso.")
        except Exception as e:
            print(f"⚠️ Unique constraint uq_categorias_restaurante_nome ignorado: {e}")


def downgrade() -> None:
    try:
        with op.batch_alter_table('categorias') as batch_op:
            batch_op.drop_constraint('uq_categorias_restaurante_nome', type_='unique')
    except Exception as e:
        print(f"⚠️ Downgrade ignorado: {e}")
