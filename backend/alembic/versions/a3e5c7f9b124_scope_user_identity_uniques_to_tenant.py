"""scope legacy user identity unique constraints to restaurant tenant

Revision ID: a3e5c7f9b124
Revises: f2d4e6a8b013
Create Date: 2026-08-18

Production databases created from the legacy schema may still carry global
unique constraints such as ``usuarios_email_key`` / ``usuarios_telefone_key``.
The current multi-tenant contract allows the same e-mail or phone in different
restaurants and enforces uniqueness only inside each ``restaurante_id``.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a3e5c7f9b124"
down_revision: Union[str, Sequence[str], None] = "f2d4e6a8b013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _unique_constraints(bind) -> dict[str, tuple[str, ...]]:
    result: dict[str, tuple[str, ...]] = {}
    for constraint in sa.inspect(bind).get_unique_constraints("usuarios"):
        name = constraint.get("name")
        columns = tuple(constraint.get("column_names") or ())
        if name:
            result[str(name)] = columns
    return result


def upgrade() -> None:
    bind = op.get_bind()
    constraints = _unique_constraints(bind)

    # Remove qualquer unicidade global legada por identidade. Não dependemos
    # apenas dos nomes históricos porque bancos antigos podem ter sido criados
    # por caminhos distintos do SQLAlchemy/PostgreSQL.
    for name, columns in constraints.items():
        if columns in {("email",), ("telefone",)}:
            op.drop_constraint(name, "usuarios", type_="unique")

    constraints = _unique_constraints(bind)
    existing_column_sets = set(constraints.values())

    if ("restaurante_id", "email") not in existing_column_sets:
        op.create_unique_constraint(
            "uq_usuarios_restaurante_email",
            "usuarios",
            ["restaurante_id", "email"],
        )
    if ("restaurante_id", "telefone") not in existing_column_sets:
        op.create_unique_constraint(
            "uq_usuarios_restaurante_telefone",
            "usuarios",
            ["restaurante_id", "telefone"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    constraints = _unique_constraints(bind)

    for name, columns in list(constraints.items()):
        if columns == ("restaurante_id", "email"):
            op.drop_constraint(name, "usuarios", type_="unique")
        elif columns == ("restaurante_id", "telefone"):
            op.drop_constraint(name, "usuarios", type_="unique")

    # O downgrade só consegue restaurar unicidade global se os dados atuais
    # ainda forem compatíveis com ela. A criação falhará explicitamente caso
    # já existam identidades repetidas entre tenants, evitando perda de dados.
    op.create_unique_constraint("usuarios_email_key", "usuarios", ["email"])
    op.create_unique_constraint("usuarios_telefone_key", "usuarios", ["telefone"])
