"""allow negative digital settlement balances in cash closing

Revision ID: 8d4c21f7a6b9
Revises: 7ab3d91e42c6
Create Date: 2026-08-16 12:21:00.000000

Dinheiro físico e fundo continuam não negativos. Pix/cartão declarados passam a
aceitar valores líquidos negativos quando o turno processa devoluções de vendas
anteriores. Limites explícitos mantêm a regra finita também em SQLite.
"""
from typing import Sequence, Union

from alembic import op


revision: str = "8d4c21f7a6b9"
down_revision: Union[str, Sequence[str], None] = "7ab3d91e42c6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


MAX_MONEY = "999999999999.99"
OLD = "ck_caixa_turnos_valores_nonnegative_finite"
PHYSICAL = "ck_caixa_turnos_physical_values_range"
DIGITAL = "ck_caixa_turnos_digital_values_range"

PHYSICAL_SQL = (
    f"saldo_inicial >= 0 AND saldo_inicial <= {MAX_MONEY} "
    f"AND (declarado_dinheiro IS NULL OR "
    f"(declarado_dinheiro >= 0 AND declarado_dinheiro <= {MAX_MONEY}))"
)
DIGITAL_SQL = (
    f"(declarado_pix IS NULL OR "
    f"(declarado_pix >= -{MAX_MONEY} AND declarado_pix <= {MAX_MONEY})) "
    f"AND (declarado_cartao IS NULL OR "
    f"(declarado_cartao >= -{MAX_MONEY} AND declarado_cartao <= {MAX_MONEY}))"
)
OLD_SQL = (
    "saldo_inicial >= 0 "
    "AND (declarado_dinheiro IS NULL OR declarado_dinheiro >= 0) "
    "AND (declarado_pix IS NULL OR declarado_pix >= 0) "
    "AND (declarado_cartao IS NULL OR declarado_cartao >= 0)"
)


def _replace_with_stage3c_constraints() -> None:
    dialect = op.get_bind().dialect.name
    if dialect == "sqlite":
        with op.batch_alter_table("caixa_turnos") as batch_op:
            batch_op.drop_constraint(OLD, type_="check")
            batch_op.create_check_constraint(PHYSICAL, PHYSICAL_SQL)
            batch_op.create_check_constraint(DIGITAL, DIGITAL_SQL)
        return

    op.drop_constraint(OLD, "caixa_turnos", type_="check")
    op.create_check_constraint(PHYSICAL, "caixa_turnos", PHYSICAL_SQL)
    op.create_check_constraint(DIGITAL, "caixa_turnos", DIGITAL_SQL)


def _restore_legacy_constraint() -> None:
    dialect = op.get_bind().dialect.name
    if dialect == "sqlite":
        with op.batch_alter_table("caixa_turnos") as batch_op:
            batch_op.drop_constraint(DIGITAL, type_="check")
            batch_op.drop_constraint(PHYSICAL, type_="check")
            batch_op.create_check_constraint(OLD, OLD_SQL)
        return

    op.drop_constraint(DIGITAL, "caixa_turnos", type_="check")
    op.drop_constraint(PHYSICAL, "caixa_turnos", type_="check")
    op.create_check_constraint(OLD, "caixa_turnos", OLD_SQL)


def upgrade() -> None:
    _replace_with_stage3c_constraints()


def downgrade() -> None:
    _restore_legacy_constraint()
