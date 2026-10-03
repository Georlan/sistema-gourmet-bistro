"""Add explicit paid complement links without changing existing catalogs."""
from alembic import op
import sqlalchemy as sa

revision = "z9f0a1b2c3d4"
down_revision = "z8e9f0a1b2c3"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("grupo_modificadores") as batch:
        batch.add_column(sa.Column("grupo_origem_id", sa.String(), nullable=True))
        batch.add_column(sa.Column("preco_novo_adicional", sa.Numeric(14, 2), nullable=True))
        batch.add_column(sa.Column("preco_novo_ovo", sa.Numeric(14, 2), nullable=True))
        batch.create_foreign_key("fk_grupo_complemento_origem", "grupo_modificadores", ["grupo_origem_id"], ["id"])
    with op.batch_alter_table("opcao_modificadores") as batch:
        batch.add_column(sa.Column("opcao_origem_id", sa.String(), nullable=True))
        batch.create_foreign_key("fk_opcao_complemento_origem", "opcao_modificadores", ["opcao_origem_id"], ["id"])
        batch.create_unique_constraint("uq_opcao_grupo_origem", ["restaurante_id", "grupo_id", "opcao_origem_id"])


def downgrade():
    with op.batch_alter_table("opcao_modificadores") as batch:
        batch.drop_constraint("uq_opcao_grupo_origem", type_="unique")
        batch.drop_constraint("fk_opcao_complemento_origem", type_="foreignkey")
        batch.drop_column("opcao_origem_id")
    with op.batch_alter_table("grupo_modificadores") as batch:
        batch.drop_constraint("fk_grupo_complemento_origem", type_="foreignkey")
        for column in ("preco_novo_ovo", "preco_novo_adicional", "grupo_origem_id"):
            batch.drop_column(column)
