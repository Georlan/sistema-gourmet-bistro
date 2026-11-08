"""Shared modifier groups inherited by real variant SKUs.

Revision ID: f2b7c9d1e3a5
Revises: f1c4e7a9b2d3
"""
from alembic import op
import sqlalchemy as sa

revision = "f2b7c9d1e3a5"
down_revision = "f1c4e7a9b2d3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "produto_familia_grupo_modificadores",
        sa.Column("restaurante_id", sa.Integer(), nullable=False),
        sa.Column("familia_id", sa.String(36), nullable=False),
        sa.Column("grupo_id", sa.String(), nullable=False),
        sa.PrimaryKeyConstraint("restaurante_id", "familia_id", "grupo_id", name="pk_produto_familia_grupo"),
        sa.ForeignKeyConstraint(["restaurante_id"], ["restaurantes.id"], name="fk_produto_familia_grupo_restaurante"),
        sa.ForeignKeyConstraint(
            ["restaurante_id", "familia_id"],
            ["produto_familias.restaurante_id", "produto_familias.id"],
            name="fk_produto_familia_grupo_familia_tenant",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["grupo_id"], ["grupo_modificadores.id"],
            name="fk_produto_familia_grupo_grupo", ondelete="CASCADE",
        ),
    )
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE produto_familia_grupo_modificadores ENABLE ROW LEVEL SECURITY")
        op.execute("""
            CREATE POLICY tenant_isolation ON produto_familia_grupo_modificadores
            USING (restaurante_id = NULLIF(current_setting('app.current_restaurante_id', true), '')::int)
            WITH CHECK (restaurante_id = NULLIF(current_setting('app.current_restaurante_id', true), '')::int)
        """)
        op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON produto_familia_grupo_modificadores TO koma_app")


def downgrade() -> None:
    op.drop_table("produto_familia_grupo_modificadores")
