"""Allow kitchen staff role in usuarios cargo constraint.

Revision ID: s8f9a0b1c2d3
Revises: r7a8b9c0d1e2
Create Date: 2026-09-28
"""

from alembic import op
import sqlalchemy as sa


revision = "s8f9a0b1c2d3"
down_revision = "r7a8b9c0d1e2"
branch_labels = None
depends_on = None

_CONSTRAINT = "ck_usuarios_cargo"
_WITH_KITCHEN = (
    "cargo IN ('admin', 'superadmin', 'caixa', 'garcom', 'gerente', "
    "'cozinha', 'motoboy')"
)
_LEGACY = (
    "cargo IN ('admin', 'superadmin', 'caixa', 'garcom', 'gerente', 'motoboy')"
)


def _replace_constraint(expression: str) -> None:
    op.drop_constraint(_CONSTRAINT, "usuarios", type_="check")
    op.create_check_constraint(_CONSTRAINT, "usuarios", expression)


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    _replace_constraint(_WITH_KITCHEN)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    kitchen_users = bind.execute(
        sa.text("SELECT COUNT(*) FROM usuarios WHERE cargo = 'cozinha'")
    ).scalar_one()
    if kitchen_users:
        raise RuntimeError(
            "Não é seguro remover o cargo cozinha enquanto existirem usuários com esse cargo."
        )

    _replace_constraint(_LEGACY)
