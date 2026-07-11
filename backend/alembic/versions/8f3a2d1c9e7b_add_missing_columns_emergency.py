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

    # ─── TABELA: comandas ─────────────────────────────────────────────────────
    # Coluna mesa_origem_id (usado para rastrear origem em caso de mescla de mesas)
    conn.execute(sa.text(
        "ALTER TABLE comandas ADD COLUMN IF NOT EXISTS mesa_origem_id INTEGER"
    ))

    # Colunas de delivery (podem não existir em bancos criados antes do recurso)
    conn.execute(sa.text(
        "ALTER TABLE comandas ADD COLUMN IF NOT EXISTS delivery_status VARCHAR DEFAULT NULL"
    ))
    conn.execute(sa.text(
        "ALTER TABLE comandas ADD COLUMN IF NOT EXISTS delivery_taxa FLOAT DEFAULT NULL"
    ))
    conn.execute(sa.text(
        "ALTER TABLE comandas ADD COLUMN IF NOT EXISTS delivery_telefone VARCHAR DEFAULT NULL"
    ))
    conn.execute(sa.text(
        "ALTER TABLE comandas ADD COLUMN IF NOT EXISTS delivery_endereco VARCHAR DEFAULT NULL"
    ))
    conn.execute(sa.text(
        "ALTER TABLE comandas ADD COLUMN IF NOT EXISTS motoboy_id VARCHAR DEFAULT NULL"
    ))
    conn.execute(sa.text(
        "ALTER TABLE comandas ADD COLUMN IF NOT EXISTS status_comanda VARCHAR DEFAULT NULL"
    ))
    conn.execute(sa.text(
        "ALTER TABLE comandas ADD COLUMN IF NOT EXISTS valor_pago FLOAT DEFAULT 0"
    ))
    conn.execute(sa.text(
        "ALTER TABLE comandas ADD COLUMN IF NOT EXISTS fechado_em TIMESTAMP DEFAULT NULL"
    ))
    conn.execute(sa.text(
        "ALTER TABLE comandas ADD COLUMN IF NOT EXISTS criado_em TIMESTAMP DEFAULT NULL"
    ))

    # ─── TABELA: itens ────────────────────────────────────────────────────────
    # Coluna restaurante_id (adicionada na fase de indexação multi-tenant)
    conn.execute(sa.text(
        "ALTER TABLE itens ADD COLUMN IF NOT EXISTS restaurante_id INTEGER DEFAULT NULL"
    ))

    # Backfill: preenche restaurante_id nos itens existentes usando a comanda pai
    conn.execute(sa.text("""
        UPDATE itens
        SET restaurante_id = c.restaurante_id
        FROM comandas c
        WHERE itens.comanda_id = c.id
          AND itens.restaurante_id IS NULL
    """))

    # Agora que está populado, cria o índice se não existir
    conn.execute(sa.text("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_indexes
                WHERE tablename = 'itens'
                  AND indexname = 'ix_itens_restaurante_id'
            ) THEN
                CREATE INDEX ix_itens_restaurante_id ON itens (restaurante_id);
            END IF;
        END
        $$;
    """))

    # ─── TABELA: lancamentos ──────────────────────────────────────────────────
    # Coluna status_comanda no lancamento (se ainda não existir)
    conn.execute(sa.text(
        "ALTER TABLE lancamentos ADD COLUMN IF NOT EXISTS numero_pedido INTEGER DEFAULT NULL"
    ))


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
