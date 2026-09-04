"""add taxa_entrega_fixa to configuracoes_restaurante

Revision ID: 7b8c9d0e1f2a
Revises: 6a7b8c9d0e1f
Create Date: 2026-09-03 17:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7b8c9d0e1f2a'
down_revision: Union[str, Sequence[str], None] = '6a7b8c9d0e1f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def safe_add_column(table_name: str, column_name: str, col_type, **kwargs):
    """Adiciona coluna de forma segura — ignora se já existir."""
    try:
        with op.batch_alter_table(table_name) as batch_op:
            batch_op.add_column(sa.Column(column_name, col_type, **kwargs))
        print(f"✅ Coluna '{column_name}' adicionada em '{table_name}'.")
    except Exception as e:
        print(f"⚠️  Ignorado: '{column_name}' em '{table_name}': {e}")


def upgrade() -> None:
    # 1. Adiciona coluna taxa_entrega_fixa com default 7.00
    safe_add_column(
        'configuracoes_restaurante',
        'taxa_entrega_fixa',
        sa.Numeric(14, 2, asdecimal=False),
        server_default='7.00',
        nullable=False,
    )

    # 2. Backfill: garante que todos os restaurantes existentes tenham R$ 7,00 caso estejam nulos
    try:
        conn = op.get_bind()
        conn.execute(sa.text(
            "UPDATE configuracoes_restaurante "
            "SET taxa_entrega_fixa = 7.00 "
            "WHERE taxa_entrega_fixa IS NULL"
        ))
        print("✅ Backfill de taxa_entrega_fixa concluído.")
    except Exception as e:
        print(f"⚠️  Ignorado erro no backfill de taxa_entrega_fixa: {e}")


def downgrade() -> None:
    with op.batch_alter_table('configuracoes_restaurante') as batch_op:
        batch_op.drop_column('taxa_entrega_fixa')
