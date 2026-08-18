"""add_missing_columns_emergency

Revision ID: 8f3a2d1c9e7b
Revises: dcbca6699d38
Create Date: 2026-07-11 14:31:00.000000

Migration de emergência: adiciona colunas que estão nos models Python mas
que não foram criadas no banco PostgreSQL do Railway porque o schema foi
inicializado via CREATE TABLE manual (main.py) antes do Alembic.

A migration precisa funcionar tanto no banco legado quanto em reconstrução do
zero. Em PostgreSQL, capturar ``DuplicateColumn`` não é idempotência: a exceção
aborta a transação inteira. Por isso a existência é verificada por introspecção
antes de qualquer DDL.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "8f3a2d1c9e7b"
down_revision: Union[str, Sequence[str], None] = "dcbca6699d38"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(conn, table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(conn)
    return column_name in {
        column["name"] for column in inspector.get_columns(table_name)
    }


def _index_exists(conn, table_name: str, index_name: str) -> bool:
    inspector = sa.inspect(conn)
    return index_name in {
        index["name"] for index in inspector.get_indexes(table_name)
    }


def _add_column_if_missing(
    conn,
    table_name: str,
    column_name: str,
    col_type,
    **kwargs,
) -> None:
    if _column_exists(conn, table_name, column_name):
        return
    with op.batch_alter_table(table_name) as batch_op:
        batch_op.add_column(sa.Column(column_name, col_type, **kwargs))


def upgrade() -> None:
    """Adiciona somente as estruturas realmente ausentes."""
    conn = op.get_bind()

    _add_column_if_missing(conn, "comandas", "mesa_origem_id", sa.Integer())
    _add_column_if_missing(conn, "comandas", "delivery_status", sa.String())
    _add_column_if_missing(conn, "comandas", "delivery_taxa", sa.Float())
    _add_column_if_missing(conn, "comandas", "delivery_telefone", sa.String())
    _add_column_if_missing(conn, "comandas", "delivery_endereco", sa.String())
    _add_column_if_missing(conn, "comandas", "motoboy_id", sa.Integer())
    _add_column_if_missing(conn, "comandas", "status_comanda", sa.String())
    _add_column_if_missing(
        conn,
        "comandas",
        "valor_pago",
        sa.Float(),
        server_default="0",
    )
    _add_column_if_missing(conn, "comandas", "fechado_em", sa.DateTime())
    _add_column_if_missing(conn, "comandas", "criado_em", sa.DateTime())

    _add_column_if_missing(conn, "itens", "restaurante_id", sa.Integer())

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

    if not _index_exists(conn, "itens", "ix_itens_restaurante_id"):
        op.create_index(
            "ix_itens_restaurante_id",
            "itens",
            ["restaurante_id"],
            unique=False,
        )

    _add_column_if_missing(conn, "lancamentos", "numero_pedido", sa.Integer())


def downgrade() -> None:
    """Remove as estruturas cujo ciclo de vida pertence a esta migration."""
    conn = op.get_bind()

    if _index_exists(conn, "itens", "ix_itens_restaurante_id"):
        op.drop_index("ix_itens_restaurante_id", table_name="itens")

    for table_name, column_name in (
        ("itens", "restaurante_id"),
        ("comandas", "mesa_origem_id"),
        ("comandas", "delivery_status"),
        ("comandas", "delivery_taxa"),
        ("comandas", "delivery_telefone"),
        ("comandas", "delivery_endereco"),
        ("comandas", "motoboy_id"),
        ("comandas", "status_comanda"),
        ("comandas", "valor_pago"),
        ("comandas", "fechado_em"),
        ("comandas", "criado_em"),
        ("lancamentos", "numero_pedido"),
    ):
        if _column_exists(conn, table_name, column_name):
            with op.batch_alter_table(table_name) as batch_op:
                batch_op.drop_column(column_name)
