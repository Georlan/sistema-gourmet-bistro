"""Allow kitchen staff role in usuarios.cargo.

Revision ID: s8b9c0d1e2f3
Revises: r7a8b9c0d1e2
Create Date: 2026-09-28
"""

from alembic import op


revision = "s8b9c0d1e2f3"
down_revision = "r7a8b9c0d1e2"
branch_labels = None
depends_on = None


OLD_CARGO_CHECK = (
    "cargo IN ('admin', 'superadmin', 'caixa', 'garcom', 'gerente', 'motoboy')"
)
NEW_CARGO_CHECK = (
    "cargo IN ('admin', 'superadmin', 'caixa', 'garcom', 'gerente', 'cozinha', 'motoboy')"
)


def _replace_cargo_check(condition: str) -> None:
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        with op.batch_alter_table("usuarios", recreate="always") as batch_op:
            batch_op.drop_constraint("ck_usuarios_cargo", type_="check")
            batch_op.create_check_constraint("ck_usuarios_cargo", condition)
        return

    op.drop_constraint("ck_usuarios_cargo", "usuarios", type_="check")
    op.create_check_constraint("ck_usuarios_cargo", "usuarios", condition)


def upgrade() -> None:
    _replace_cargo_check(NEW_CARGO_CHECK)


def downgrade() -> None:
    _replace_cargo_check(OLD_CARGO_CHECK)
