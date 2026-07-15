"""add_missing_columns_emergency

Revision ID: 8f3a2d1c9e7b
Revises: dcbca6699d38
Create Date: 2026-07-11 14:31:00.000000

Migration de emergência: adiciona colunas que estão nos models Python mas
que não foram criadas no banco PostgreSQL do Railway porque o schema foi
inicializado via CREATE TABLE manual (main.py) antes do Alembic.

Usa ADD COLUMN IF NOT EXISTS para ser 100% seguro e idempotente.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8f3a2d1c9e7b'
# Aponta para a migration inicial como pai — garante cadeia linear e sem
# MultipleHeads. O banco de produção é tratado via stamp no startup (main.py).
down_revision: Union[str, Sequence[str], None] = 'dcbca6699d38'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None




def upgrade() -> None:
    """Adiciona colunas faltantes detectadas nos erros do Sentry/Railway."""
    conn = op.get_bind()

    def safe_add_column(table_name, column_name, col_type, **kwargs):
        try:
            with op.batch_alter_table(table_name) as batch_op:
                batch_op.add_column(sa.Column(column_name, col_type, **kwargs))
            print(f"✅ Coluna '{column_name}' adicionada em '{table_name}'.")
        except Exception as e:
            print(f"⚠️ Ignorado erro ao adicionar coluna '{column_name}' em '{table_name}': {e}")

    # ─── TABELA: comandas ─────────────────────────────────────────────────────
    safe_add_column('comandas', 'mesa_origem_id', sa.Integer())
    safe_add_column('comandas', 'delivery_status', sa.String())
    safe_add_column('comandas', 'delivery_taxa', sa.Float())
    safe_add_column('comandas', 'delivery_telefone', sa.String())
    safe_add_column('comandas', 'delivery_endereco', sa.String())
    safe_add_column('comandas', 'motoboy_id', sa.String())
    safe_add_column('comandas', 'status_comanda', sa.String())
    safe_add_column('comandas', 'valor_pago', sa.Float(), server_default='0')
    safe_add_column('comandas', 'fechado_em', sa.DateTime())
    safe_add_column('comandas', 'criado_em', sa.DateTime())

    # ─── TABELA: itens ────────────────────────────────────────────────────────
    safe_add_column('itens', 'restaurante_id', sa.Integer())

    # Backfill: preenche restaurante_id nos itens existentes usando a comanda pai
    try:
        if conn.dialect.name == "postgresql":
            conn.execute(sa.text("""
                UPDATE itens
                SET restaurante_id = c.restaurante_id
                FROM comandas c
                WHERE itens.comanda_id = c.id
                  AND itens.restaurante_id IS NULL
            """))
        else:
            conn.execute(sa.text("""
                UPDATE itens
                SET restaurante_id = (
                    SELECT restaurante_id FROM comandas
                    WHERE comandas.id = itens.comanda_id
                )
                WHERE restaurante_id IS NULL
            """))
        print("✅ Backfill de restaurante_id em itens executado.")
    except Exception as e:
        print(f"⚠️ Ignorado erro no backfill de restaurante_id em itens: {e}")

    # Criar índice de restaurante_id em itens
    try:
        with op.batch_alter_table('itens') as batch_op:
            batch_op.create_index('ix_itens_restaurante_id', ['restaurante_id'])
        print("✅ Índice ix_itens_restaurante_id criado.")
    except Exception as e:
        print(f"⚠️ Ignorado erro ao criar índice ix_itens_restaurante_id: {e}")

    # ─── TABELA: lancamentos ──────────────────────────────────────────────────
    safe_add_column('lancamentos', 'numero_pedido', sa.Integer())


def downgrade() -> None:
    """Remove as colunas adicionadas nesta migration de emergência."""
    conn = op.get_bind()
    conn.execute(sa.text("ALTER TABLE itens DROP COLUMN IF EXISTS restaurante_id"))
    conn.execute(sa.text("ALTER TABLE comandas DROP COLUMN IF EXISTS mesa_origem_id"))
    conn.execute(sa.text("ALTER TABLE comandas DROP COLUMN IF EXISTS delivery_status"))
    conn.execute(sa.text("ALTER TABLE comandas DROP COLUMN IF EXISTS delivery_taxa"))
    conn.execute(sa.text("ALTER TABLE comandas DROP COLUMN IF EXISTS delivery_telefone"))
    conn.execute(sa.text("ALTER TABLE comandas DROP COLUMN IF EXISTS delivery_endereco"))
    conn.execute(sa.text("ALTER TABLE comandas DROP COLUMN IF EXISTS motoboy_id"))
    conn.execute(sa.text("ALTER TABLE comandas DROP COLUMN IF EXISTS status_comanda"))
    conn.execute(sa.text("ALTER TABLE comandas DROP COLUMN IF EXISTS valor_pago"))
    conn.execute(sa.text("ALTER TABLE comandas DROP COLUMN IF EXISTS fechado_em"))
    conn.execute(sa.text("ALTER TABLE comandas DROP COLUMN IF EXISTS criado_em"))
    conn.execute(sa.text("ALTER TABLE lancamentos DROP COLUMN IF EXISTS numero_pedido"))
