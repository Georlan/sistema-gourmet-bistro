"""add canonical fixed delivery fee

Revision ID: 5f6a7b8c9d0e
Revises: 4e5f6a7b8c9d
Create Date: 2026-09-03 19:35:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "5f6a7b8c9d0e"
down_revision = "4e5f6a7b8c9d"
branch_labels = None
depends_on = None


CONSTRAINT_NAME = "ck_config_restaurante_taxa_entrega_padrao"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    op.add_column(
        "configuracoes_restaurante",
        sa.Column(
            "taxa_entrega_padrao",
            sa.Numeric(14, 2, asdecimal=False),
            nullable=False,
            server_default=sa.text("7.00"),
        ),
    )

    # Alguns bancos legados podem ter recebido esta coluna diretamente em
    # restaurantes. Quando existir, preserva o valor antes de consolidar a
    # fonte de verdade em configuracoes_restaurante.
    restaurante_columns = {
        column["name"] for column in inspector.get_columns("restaurantes")
    }
    if "taxa_entrega_padrao" in restaurante_columns:
        op.execute(
            sa.text(
                """
                UPDATE configuracoes_restaurante AS config
                SET taxa_entrega_padrao = COALESCE(
                    (
                        SELECT restaurante.taxa_entrega_padrao
                        FROM restaurantes AS restaurante
                        WHERE restaurante.id = config.restaurante_id
                    ),
                    7.00
                )
                """
            )
        )

    if bind.dialect.name == "postgresql":
        op.create_check_constraint(
            CONSTRAINT_NAME,
            "configuracoes_restaurante",
            "taxa_entrega_padrao BETWEEN 0 AND 10000",
        )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.drop_constraint(
            CONSTRAINT_NAME,
            "configuracoes_restaurante",
            type_="check",
        )
    op.drop_column("configuracoes_restaurante", "taxa_entrega_padrao")
