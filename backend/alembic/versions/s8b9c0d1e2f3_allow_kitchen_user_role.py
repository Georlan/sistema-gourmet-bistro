"""Allow kitchen staff in usuarios cargo constraint."""

from alembic import op

revision = "s8b9c0d1e2f3"
down_revision = "r7a8b9c0d1e2"
branch_labels = None
depends_on = None

_NEW_CARGO_CHECK = (
    "cargo IN ('admin', 'superadmin', 'caixa', 'garcom', 'gerente', 'cozinha', 'motoboy')"
)
_OLD_CARGO_CHECK = (
    "cargo IN ('admin', 'superadmin', 'caixa', 'garcom', 'gerente', 'motoboy')"
)


def _replace_constraint(expression: str) -> None:
    with op.batch_alter_table("usuarios") as batch_op:
        batch_op.drop_constraint("ck_usuarios_cargo", type_="check")
        batch_op.create_check_constraint("ck_usuarios_cargo", expression)


def upgrade() -> None:
    _replace_constraint(_NEW_CARGO_CHECK)


def downgrade() -> None:
    _replace_constraint(_OLD_CARGO_CHECK)
