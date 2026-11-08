"""Explicit multitenant product families with real purchasable variant SKUs.

Revision ID: b1c2d3e4f5a6
Revises: f0a1b2c3d4e5
"""
from alembic import op
import sqlalchemy as sa

revision = "b1c2d3e4f5a6"
down_revision = "f0a1b2c3d4e5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "produto_familias",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("restaurante_id", sa.Integer(), nullable=False),
        sa.Column("nome", sa.String(160), nullable=False),
        sa.Column("descricao", sa.Text(), nullable=False, server_default=""),
        sa.Column("eixo", sa.String(20), nullable=False),
        sa.Column("categoria_id", sa.String(), nullable=False),
        sa.Column("cardapio_id", sa.String(36), nullable=True),
        sa.Column("imagem", sa.Text(), nullable=False, server_default=""),
        sa.UniqueConstraint("restaurante_id", "id", name="uq_produto_familias_tenant_id"),
        sa.ForeignKeyConstraint(["restaurante_id"], ["restaurantes.id"], ondelete="RESTRICT", name="fk_produto_familias_tenant"),
        sa.ForeignKeyConstraint(["restaurante_id", "categoria_id"], ["categorias.restaurante_id", "categorias.id"], ondelete="RESTRICT", name="fk_produto_familias_categoria_tenant"),
        sa.ForeignKeyConstraint(["restaurante_id", "cardapio_id"], ["cardapios.restaurante_id", "cardapios.id"], ondelete="RESTRICT", name="fk_produto_familias_cardapio_tenant"),
        sa.CheckConstraint("eixo IN ('tamanho', 'sabor', 'outra')", name="ck_produto_familias_eixo"),
    )
    # batch_alter_table mantém compatibilidade com migrações SQLite de testes.
    with op.batch_alter_table("produtos") as batch:
        batch.add_column(sa.Column("familia_id", sa.String(36), nullable=True))
        batch.add_column(sa.Column("variacao_rotulo", sa.String(100), nullable=True))
        batch.create_foreign_key(
            "fk_produtos_familia_tenant", "produto_familias",
            ["restaurante_id", "familia_id"], ["restaurante_id", "id"],
            ondelete="RESTRICT",
        )
        batch.create_check_constraint(
            "ck_produtos_familia_rotulo",
            "(familia_id IS NULL AND variacao_rotulo IS NULL) OR "
            "(familia_id IS NOT NULL AND variacao_rotulo IS NOT NULL AND length(trim(variacao_rotulo)) > 0)",
        )
    op.create_index(
        "uq_produtos_tenant_familia_rotulo", "produtos",
        ["restaurante_id", "familia_id", "variacao_rotulo"], unique=True,
    )
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE produto_familias ENABLE ROW LEVEL SECURITY")
        op.execute("""
            CREATE POLICY tenant_isolation ON produto_familias
            USING (restaurante_id = NULLIF(current_setting('app.current_restaurante_id', true), '')::int)
            WITH CHECK (restaurante_id = NULLIF(current_setting('app.current_restaurante_id', true), '')::int)
        """)
        op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON produto_familias TO koma_app")


def downgrade() -> None:
    # A reversão estrutural elimina a organização em famílias, mas NUNCA apaga
    # os SKUs de produtos, pedidos ou históricos; planejar rollback antes de usar.
    op.drop_index("uq_produtos_tenant_familia_rotulo", table_name="produtos")
    with op.batch_alter_table("produtos") as batch:
        batch.drop_constraint("ck_produtos_familia_rotulo", type_="check")
        batch.drop_constraint("fk_produtos_familia_tenant", type_="foreignkey")
        batch.drop_column("variacao_rotulo")
        batch.drop_column("familia_id")
    op.drop_table("produto_familias")
