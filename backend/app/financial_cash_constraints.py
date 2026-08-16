from __future__ import annotations

from sqlalchemy import CheckConstraint

from .database import Base


MAX_MONEY = "999999999999.99"
OLD_CONSTRAINT = "ck_caixa_turnos_valores_nonnegative_finite"
PHYSICAL_CONSTRAINT = "ck_caixa_turnos_physical_values_range"
DIGITAL_CONSTRAINT = "ck_caixa_turnos_digital_values_range"

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


def apply_cash_turno_constraints_to_metadata() -> None:
    """Mantém o metadata SQLAlchemy alinhado com a migration da Etapa 3C.

    O modelo histórico agrupava fundo, dinheiro, Pix e cartão em uma única
    constraint >= 0. Isso deixou de representar o domínio quando devoluções de
    vendas antigas podem produzir liquidação digital líquida negativa.

    A migration altera o banco persistente; este adaptador altera o metadata em
    runtime/testes sem duplicar a classe CaixaTurno durante a Etapa 3.
    """
    table = Base.metadata.tables.get("caixa_turnos")
    if table is None:
        return

    existing_names = {
        getattr(constraint, "name", None)
        for constraint in table.constraints
    }
    if OLD_CONSTRAINT in existing_names:
        for constraint in list(table.constraints):
            if (
                isinstance(constraint, CheckConstraint)
                and constraint.name == OLD_CONSTRAINT
            ):
                table.constraints.remove(constraint)
                break

    existing_names = {
        getattr(constraint, "name", None)
        for constraint in table.constraints
    }
    if PHYSICAL_CONSTRAINT not in existing_names:
        table.append_constraint(
            CheckConstraint(PHYSICAL_SQL, name=PHYSICAL_CONSTRAINT)
        )
    if DIGITAL_CONSTRAINT not in existing_names:
        table.append_constraint(
            CheckConstraint(DIGITAL_SQL, name=DIGITAL_CONSTRAINT)
        )


apply_cash_turno_constraints_to_metadata()
