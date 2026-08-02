"""use exact numeric types for monetary values

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-08-02 12:00:00.000000

Prices, payments and totals use two decimal places. Unit costs and loyalty
conversion values keep four decimal places so weighted-average inventory
calculations do not lose precision before the final total is rounded.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b8c9d0e1f2a3"
down_revision: Union[str, Sequence[str], None] = "a7b8c9d0e1f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# table, column, scale
MONEY_COLUMNS: tuple[tuple[str, str, int], ...] = (
    ("produtos", "preco", 2),
    ("comandas", "valor_pago", 2),
    ("comandas", "delivery_taxa", 2),
    ("itens", "preco_unit", 2),
    ("caixa_turnos", "saldo_inicial", 2),
    ("caixa_turnos", "declarado_dinheiro", 2),
    ("caixa_turnos", "declarado_pix", 2),
    ("caixa_turnos", "declarado_cartao", 2),
    ("caixa_movimentacoes", "valor", 2),
    ("caixa_movimentacoes", "saldo_anterior", 2),
    ("caixa_movimentacoes", "saldo_posterior", 2),
    ("pagamentos", "valor", 2),
    ("configuracoes_restaurante", "meta_mensal", 2),
    ("opcao_modificadores", "preco_adicional", 2),
    ("item_modificadores", "preco_aplicado", 2),
    ("insumos", "preco_medio_custo", 4),
    ("config_fidelizacao", "valor_ponto_em_dinheiro", 4),
    ("historico_fidelidade", "valor_delta", 4),
    ("clientes", "saldo_cashback", 2),
    ("notas_entrada", "valor_total", 2),
    ("itens_nota_entrada", "preco_unitario", 4),
    ("entradas_estoque", "valor_total", 2),
    ("itens_entrada_estoque", "custo_unitario", 4),
    ("itens_entrada_estoque", "subtotal", 2),
    ("movimentacoes_estoque", "custo_unitario", 4),
)


FINANCIAL_CHECKS: tuple[tuple[str, str, str], ...] = (
    ("produtos", "ck_produtos_preco_nonnegative_finite", "preco >= 0"),
    ("itens", "ck_itens_preco_unit_nonnegative_finite", "preco_unit >= 0"),
    ("pagamentos", "ck_pagamentos_valor_positive_finite", "valor > 0"),
    (
        "comandas",
        "ck_comandas_valores_nonnegative_finite",
        "valor_pago >= 0 AND (delivery_taxa IS NULL OR delivery_taxa >= 0)",
    ),
    (
        "caixa_turnos",
        "ck_caixa_turnos_valores_nonnegative_finite",
        "saldo_inicial >= 0 "
        "AND (declarado_dinheiro IS NULL OR declarado_dinheiro >= 0) "
        "AND (declarado_pix IS NULL OR declarado_pix >= 0) "
        "AND (declarado_cartao IS NULL OR declarado_cartao >= 0)",
    ),
    (
        "caixa_movimentacoes",
        "ck_caixa_movimentacoes_valor_positive_finite",
        "valor > 0",
    ),
    (
        "clientes",
        "ck_clientes_cashback_nonnegative_finite",
        "saldo_cashback >= 0",
    ),
)


FLOAT_FINANCIAL_CHECKS: tuple[tuple[str, str, str], ...] = (
    (
        "produtos",
        "ck_produtos_preco_nonnegative_finite",
        "preco >= 0 AND preco < 'Infinity'::double precision",
    ),
    (
        "itens",
        "ck_itens_preco_unit_nonnegative_finite",
        "preco_unit >= 0 AND preco_unit < 'Infinity'::double precision",
    ),
    (
        "pagamentos",
        "ck_pagamentos_valor_positive_finite",
        "valor > 0 AND valor < 'Infinity'::double precision",
    ),
    (
        "comandas",
        "ck_comandas_valores_nonnegative_finite",
        "valor_pago >= 0 "
        "AND valor_pago < 'Infinity'::double precision "
        "AND (delivery_taxa IS NULL OR "
        "(delivery_taxa >= 0 AND delivery_taxa < 'Infinity'::double precision))",
    ),
    (
        "caixa_turnos",
        "ck_caixa_turnos_valores_nonnegative_finite",
        "saldo_inicial >= 0 "
        "AND saldo_inicial < 'Infinity'::double precision "
        "AND (declarado_dinheiro IS NULL OR "
        "(declarado_dinheiro >= 0 AND declarado_dinheiro < 'Infinity'::double precision)) "
        "AND (declarado_pix IS NULL OR "
        "(declarado_pix >= 0 AND declarado_pix < 'Infinity'::double precision)) "
        "AND (declarado_cartao IS NULL OR "
        "(declarado_cartao >= 0 AND declarado_cartao < 'Infinity'::double precision))",
    ),
    (
        "caixa_movimentacoes",
        "ck_caixa_movimentacoes_valor_positive_finite",
        "valor > 0 AND valor < 'Infinity'::double precision",
    ),
    (
        "clientes",
        "ck_clientes_cashback_nonnegative_finite",
        "saldo_cashback >= 0 AND saldo_cashback < 'Infinity'::double precision",
    ),
)


def _drop_financial_checks() -> None:
    for table_name, constraint_name, _condition in FINANCIAL_CHECKS:
        op.drop_constraint(constraint_name, table_name, type_="check")


def _create_financial_checks() -> None:
    for table_name, constraint_name, condition in FINANCIAL_CHECKS:
        op.create_check_constraint(constraint_name, table_name, condition)


def _create_float_financial_checks() -> None:
    for table_name, constraint_name, condition in FLOAT_FINANCIAL_CHECKS:
        op.create_check_constraint(constraint_name, table_name, condition)


def upgrade() -> None:
    dialect = op.get_bind().dialect.name

    if dialect == "postgresql":
        _drop_financial_checks()
        for table_name, column_name, scale in MONEY_COLUMNS:
            op.alter_column(
                table_name,
                column_name,
                existing_type=sa.Float(),
                type_=sa.Numeric(14, scale),
                postgresql_using=(
                    f"round({column_name}::numeric, {scale})"
                ),
            )
        _create_financial_checks()
        return

    # Local SQLite is used only for development/tests. Batch mode preserves
    # compatibility without introducing PostgreSQL-specific casts.
    for table_name, column_name, scale in MONEY_COLUMNS:
        with op.batch_alter_table(table_name) as batch_op:
            batch_op.alter_column(
                column_name,
                existing_type=sa.Float(),
                type_=sa.Numeric(14, scale),
            )


def downgrade() -> None:
    dialect = op.get_bind().dialect.name

    if dialect == "postgresql":
        _drop_financial_checks()
        for table_name, column_name, scale in reversed(MONEY_COLUMNS):
            op.alter_column(
                table_name,
                column_name,
                existing_type=sa.Numeric(14, scale),
                type_=sa.Float(),
                postgresql_using=f"{column_name}::double precision",
            )
        _create_float_financial_checks()
        return

    for table_name, column_name, scale in reversed(MONEY_COLUMNS):
        with op.batch_alter_table(table_name) as batch_op:
            batch_op.alter_column(
                column_name,
                existing_type=sa.Numeric(14, scale),
                type_=sa.Float(),
            )
