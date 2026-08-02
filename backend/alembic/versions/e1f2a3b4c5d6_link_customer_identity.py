"""link orders, payments and loyalty ledger to stable customer ids

Revision ID: e1f2a3b4c5d6
Revises: d0e1f2a3b4c5
Create Date: 2026-08-02 16:00:00.000000

The phone remains the tenant-scoped natural lookup key, while ``clientes.id``
is the durable relationship key. A customer can therefore change phone or
name without losing orders, payments or loyalty movements.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e1f2a3b4c5d6"
down_revision: Union[str, Sequence[str], None] = "d0e1f2a3b4c5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_CUSTOMER_LINKS = (
    (
        "comandas",
        "fk_comandas_cliente_tenant",
        "ix_comandas_tenant_cliente_fk",
    ),
    (
        "pagamentos",
        "fk_pagamentos_cliente_tenant",
        "ix_pagamentos_tenant_cliente_fk",
    ),
    (
        "historico_fidelidade",
        "fk_historico_fidelidade_cliente_tenant",
        "ix_historico_fidelidade_tenant_cliente_fk",
    ),
)


def _postgres_constraint(constraint_name: str, statement: str) -> None:
    op.execute(f"""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = '{constraint_name}'
            ) THEN
                {statement};
            END IF;
        END
        $$
    """)


def _postgres_upgrade() -> None:
    _postgres_constraint(
        "uq_clientes_restaurante_id_id",
        "ALTER TABLE public.clientes "
        "ADD CONSTRAINT uq_clientes_restaurante_id_id "
        "UNIQUE (restaurante_id, id)",
    )

    for table_name, constraint_name, index_name in _CUSTOMER_LINKS:
        op.execute(
            f"ALTER TABLE public.{table_name} "
            "ADD COLUMN IF NOT EXISTS cliente_id VARCHAR"
        )
        _postgres_constraint(
            constraint_name,
            f"ALTER TABLE public.{table_name} "
            f"ADD CONSTRAINT {constraint_name} "
            "FOREIGN KEY (restaurante_id, cliente_id) "
            "REFERENCES public.clientes (restaurante_id, id) "
            "ON DELETE RESTRICT",
        )
        op.execute(
            f"CREATE INDEX IF NOT EXISTS {index_name} "
            f"ON public.{table_name} (restaurante_id, cliente_id)"
        )

    # Legacy rows that predate field encryption can be linked safely in SQL.
    # Encrypted snapshots are intentionally left nullable and are reconciled by
    # the application when the customer is next identified.
    op.execute("""
        UPDATE public.comandas AS pedido
        SET cliente_id = cliente.id
        FROM public.clientes AS cliente
        WHERE pedido.cliente_id IS NULL
          AND pedido.restaurante_id = cliente.restaurante_id
          AND pedido.delivery_telefone = cliente.telefone
          AND pedido.delivery_telefone NOT LIKE 'gAAAAA%'
    """)
    op.execute("""
        UPDATE public.historico_fidelidade AS movimento
        SET cliente_id = cliente.id
        FROM public.clientes AS cliente
        WHERE movimento.cliente_id IS NULL
          AND movimento.restaurante_id = cliente.restaurante_id
          AND movimento.cliente_telefone = cliente.telefone
          AND movimento.cliente_telefone NOT LIKE 'gAAAAA%'
    """)
    op.execute("""
        UPDATE public.pagamentos AS pagamento
        SET cliente_id = cliente.id
        FROM public.clientes AS cliente
        WHERE pagamento.cliente_id IS NULL
          AND pagamento.restaurante_id = cliente.restaurante_id
          AND pagamento.cpf_cliente = cliente.telefone
    """)


def _sqlite_upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    customer_constraints = {
        item.get("name")
        for item in inspector.get_unique_constraints("clientes")
    }
    if "uq_clientes_restaurante_id_id" not in customer_constraints:
        with op.batch_alter_table("clientes") as batch_op:
            batch_op.create_unique_constraint(
                "uq_clientes_restaurante_id_id",
                ["restaurante_id", "id"],
            )

    for table_name, constraint_name, index_name in _CUSTOMER_LINKS:
        columns = {item["name"] for item in inspector.get_columns(table_name)}
        with op.batch_alter_table(table_name) as batch_op:
            if "cliente_id" not in columns:
                batch_op.add_column(sa.Column("cliente_id", sa.String(), nullable=True))
            batch_op.create_foreign_key(
                constraint_name,
                "clientes",
                ["restaurante_id", "cliente_id"],
                ["restaurante_id", "id"],
                ondelete="RESTRICT",
            )
            batch_op.create_index(
                index_name,
                ["restaurante_id", "cliente_id"],
                unique=False,
            )


def upgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        _postgres_upgrade()
    else:
        _sqlite_upgrade()


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        for table_name, constraint_name, index_name in reversed(_CUSTOMER_LINKS):
            op.execute(
                f"ALTER TABLE public.{table_name} "
                f"DROP CONSTRAINT IF EXISTS {constraint_name}"
            )
            op.execute(f"DROP INDEX IF EXISTS public.{index_name}")
            op.execute(
                f"ALTER TABLE public.{table_name} "
                "DROP COLUMN IF EXISTS cliente_id"
            )
        op.execute(
            "ALTER TABLE public.clientes "
            "DROP CONSTRAINT IF EXISTS uq_clientes_restaurante_id_id"
        )
        return

    for table_name, constraint_name, index_name in reversed(_CUSTOMER_LINKS):
        with op.batch_alter_table(table_name) as batch_op:
            batch_op.drop_index(index_name)
            batch_op.drop_constraint(constraint_name, type_="foreignkey")
            batch_op.drop_column("cliente_id")
    with op.batch_alter_table("clientes") as batch_op:
        batch_op.drop_constraint(
            "uq_clientes_restaurante_id_id",
            type_="unique",
        )
