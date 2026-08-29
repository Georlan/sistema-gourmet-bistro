"""add lancamento status column with backfill and check constraint

Revision ID: e2f3a4b5c6d7
Revises: 7d8e9f0a1b2c
Create Date: 2026-08-29 12:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e2f3a4b5c6d7"
down_revision: Union[str, Sequence[str], None] = "7d8e9f0a1b2c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    lancamentos_cols = [c["name"] for c in inspector.get_columns("lancamentos")]

    # 1. Adiciona coluna status se ainda não existir
    if "status" not in lancamentos_cols:
        op.add_column(
            "lancamentos",
            sa.Column(
                "status",
                sa.String(32),
                nullable=True,
                server_default="pendente",
            ),
        )

    # 2. Backfill seguro a partir do estado de itens e comanda
    op.execute(
        sa.text(
            """
            UPDATE lancamentos
            SET status = CASE
                WHEN EXISTS (
                    SELECT 1 FROM comandas
                    WHERE comandas.id = lancamentos.comanda_id
                    AND comandas.fechada = true
                ) THEN 'finalizado'
                WHEN EXISTS (
                    SELECT 1 FROM itens
                    WHERE itens.lancamento_id = lancamentos.id
                    AND itens.status = 'pronto'
                ) THEN 'pronto'
                WHEN EXISTS (
                    SELECT 1 FROM itens
                    WHERE itens.lancamento_id = lancamentos.id
                    AND itens.status = 'preparando'
                ) THEN 'producao'
                WHEN EXISTS (
                    SELECT 1 FROM itens
                    WHERE itens.lancamento_id = lancamentos.id
                    AND itens.status = 'cancelado'
                ) THEN 'cancelado'
                ELSE 'pendente'
            END
            WHERE status IS NULL OR status = 'pendente'
            """
        )
    )

    # 3. Garante NOT NULL
    with op.batch_alter_table("lancamentos") as batch_op:
        batch_op.alter_column(
            "status",
            nullable=False,
            server_default="pendente",
        )

    # 4. Cria constraint ck_lancamentos_status e índice se não existirem
    try:
        op.create_check_constraint(
            "ck_lancamentos_status",
            "lancamentos",
            "status IN ('pendente', 'aceito', 'producao', 'pronto', 'finalizado', 'recusado', 'cancelado')",
        )
    except Exception:
        pass

    try:
        op.create_index(
            "ix_lancamentos_status",
            "lancamentos",
            ["status"],
            unique=False,
        )
    except Exception:
        pass


def downgrade() -> None:
    try:
        op.drop_index("ix_lancamentos_status", table_name="lancamentos")
    except Exception:
        pass

    try:
        op.drop_constraint("ck_lancamentos_status", "lancamentos", type_="check")
    except Exception:
        pass

    try:
        op.drop_column("lancamentos", "status")
    except Exception:
        pass
