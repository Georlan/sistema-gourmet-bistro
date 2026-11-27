"""Add configurable pricing rule column for meio_a_meio modifier groups."""
from alembic import op
import sqlalchemy as sa


revision = "20261127a001"
down_revision = "20261126c105"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("grupo_modificadores")}
    if "regra_preco_meio_a_meio" not in columns:
        op.add_column(
            "grupo_modificadores",
            sa.Column(
                "regra_preco_meio_a_meio",
                sa.String(length=24),
                server_default=sa.text("'maior_preco'"),
                nullable=False,
            ),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("grupo_modificadores")}
    if "regra_preco_meio_a_meio" in columns:
        op.drop_column("grupo_modificadores", "regra_preco_meio_a_meio")
