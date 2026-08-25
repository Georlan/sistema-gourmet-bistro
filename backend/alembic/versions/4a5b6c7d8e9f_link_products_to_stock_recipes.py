"""link products to stock recipes and make automatic movements idempotent

Revision ID: 4a5b6c7d8e9f
Revises: 349e82d1a3a8
Create Date: 2026-08-25 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "4a5b6c7d8e9f"
down_revision: Union[str, Sequence[str], None] = "349e82d1a3a8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "produto_insumos",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("restaurante_id", sa.Integer(), nullable=False),
        sa.Column("produto_id", sa.String(), nullable=False),
        sa.Column("insumo_id", sa.String(), nullable=False),
        sa.Column("quantidade", sa.Float(), nullable=False),
        sa.CheckConstraint(
            "quantidade > 0",
            name="ck_produto_insumos_quantidade_positive_finite",
        ),
        sa.ForeignKeyConstraint(
            ["insumo_id"],
            ["insumos.id"],
            name="fk_produto_insumos_insumo",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["restaurante_id"],
            ["restaurantes.id"],
            name="fk_produto_insumos_restaurante",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["restaurante_id", "produto_id"],
            ["produtos.restaurante_id", "produtos.id"],
            name="fk_produto_insumos_produto_tenant",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "restaurante_id",
            "produto_id",
            "insumo_id",
            name="uq_produto_insumos_tenant_produto_insumo",
        ),
    )
    op.create_index(
        "ix_produto_insumos_restaurante_id",
        "produto_insumos",
        ["restaurante_id"],
    )
    op.create_index(
        "ix_produto_insumos_tenant_produto",
        "produto_insumos",
        ["restaurante_id", "produto_id"],
    )
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TABLE produto_insumos ENABLE ROW LEVEL SECURITY")
        op.execute("ALTER TABLE produto_insumos FORCE ROW LEVEL SECURITY")
        op.execute(
            """
            CREATE POLICY tenant_isolation ON produto_insumos
            AS PERMISSIVE
            FOR ALL
            TO koma_app
            USING (
                restaurante_id = NULLIF(
                    (SELECT current_setting('app.current_restaurante_id', true)),
                    ''
                )::integer
            )
            WITH CHECK (
                restaurante_id = NULLIF(
                    (SELECT current_setting('app.current_restaurante_id', true)),
                    ''
                )::integer
            )
            """
        )
        op.execute(
            "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE produto_insumos TO koma_app"
        )
        op.execute(
            "GRANT USAGE, SELECT ON SEQUENCE produto_insumos_id_seq TO koma_app"
        )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("DROP POLICY IF EXISTS tenant_isolation ON produto_insumos")
        op.execute("ALTER TABLE produto_insumos DISABLE ROW LEVEL SECURITY")

    op.drop_index("ix_produto_insumos_tenant_produto", table_name="produto_insumos")
    op.drop_index("ix_produto_insumos_restaurante_id", table_name="produto_insumos")
    op.drop_table("produto_insumos")
