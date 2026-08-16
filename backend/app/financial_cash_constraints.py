from __future__ import annotations

from sqlalchemy import CheckConstraint, event

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

    A tabela histórica nasce em `models.py` com uma constraint única >= 0. Como
    alguns imports podem materializar `CaixaTurno` depois da primeira chamada
    deste módulo, a função também é reaplicada no evento `MetaData.before_create`.
    Assim qualquer `Base.metadata.create_all()` usa a semântica 3C no instante
    exato em que o DDL será emitido.
    """
    table = Base.metadata.tables.get("caixa_turnos")
    if table is None:
        return

    for constraint in list(table.constraints):
        if (
            isinstance(constraint, CheckConstraint)
            and constraint.name == OLD_CONSTRAINT
        ):
            table.constraints.remove(constraint)

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


def _before_metadata_create(_target, _connection, **_kwargs) -> None:
    apply_cash_turno_constraints_to_metadata()


apply_cash_turno_constraints_to_metadata()
if not event.contains(Base.metadata, "before_create", _before_metadata_create):
    event.listen(Base.metadata, "before_create", _before_metadata_create)
