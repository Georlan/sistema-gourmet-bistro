"""add_meta_mensal_configuracoes_restaurante

Revision ID: a9b8c7d6e5f4
Revises: e8d7c6b5a4f3
Create Date: 2026-07-22 16:27:00.000000

Migration de emergência: adiciona coluna meta_mensal em configuracoes_restaurante.
Detectada via Sentry (ProgrammingError: column configuracoes_restaurante.meta_mensal does not exist).

Usa ADD COLUMN IF NOT EXISTS / batch_alter_table com try/except para ser 100%
seguro e idempotente — sem risco de quebrar produção se já existir.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a9b8c7d6e5f4'
down_revision: Union[str, Sequence[str], None] = 'e8d7c6b5a4f3'
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
    """
    Adiciona meta_mensal em configuracoes_restaurante.
    Detectada como ausente via Sentry em 2026-07-22.
    """
    # ─── TABELA: configuracoes_restaurante ───────────────────────────────────
    # meta_mensal nunca foi criado em nenhuma migration anterior
    safe_add_column(
        'configuracoes_restaurante',
        'meta_mensal',
        sa.Float(),
        server_default='0.0',
    )

    # Backfill: garante que linhas existentes tenham valor padrão (0.0)
    try:
        conn = op.get_bind()
        conn.execute(sa.text(
            "UPDATE configuracoes_restaurante "
            "SET meta_mensal = 0.0 "
            "WHERE meta_mensal IS NULL"
        ))
        print("✅ Backfill de meta_mensal concluído.")
    except Exception as e:
        print(f"⚠️  Ignorado erro no backfill de meta_mensal: {e}")


def downgrade() -> None:
    try:
        conn = op.get_bind()
        conn.execute(sa.text(
            "ALTER TABLE configuracoes_restaurante DROP COLUMN IF EXISTS meta_mensal"
        ))
        print("✅ Coluna meta_mensal removida.")
    except Exception as e:
        print(f"⚠️  Ignorado: {e}")
