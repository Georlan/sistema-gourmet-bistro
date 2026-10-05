"""delivery area restriction and private order attribution

Revision ID: b4c5d6e7f8a9
Revises: a3af4de4e221
Create Date: 2026-10-05 18:50:00.000000
"""

from alembic import op
import sqlalchemy as sa

revision = "b4c5d6e7f8a9"
down_revision = "a3af4de4e221"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "configuracoes_restaurante",
        sa.Column("delivery_area_restriction_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "configuracoes_restaurante",
        sa.Column("delivery_allowed_cities", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
    )
    op.add_column(
        "configuracoes_restaurante",
        sa.Column("delivery_allowed_neighborhoods", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
    )

    op.create_table(
        "public_order_attributions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("restaurante_id", sa.Integer(), sa.ForeignKey("restaurantes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("comanda_id", sa.String(), sa.ForeignKey("comandas.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_platform", sa.String(40), nullable=False, server_default="direct"),
        sa.Column("utm_source", sa.String(160), nullable=True),
        sa.Column("utm_medium", sa.String(160), nullable=True),
        sa.Column("utm_campaign", sa.String(160), nullable=True),
        sa.Column("utm_content", sa.String(160), nullable=True),
        sa.Column("referrer_host", sa.String(255), nullable=True),
        sa.Column("landing_path", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("comanda_id", name="uq_public_order_attribution_comanda"),
    )
    op.create_index(
        "ix_public_order_attributions_tenant_created",
        "public_order_attributions",
        ["restaurante_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_public_order_attributions_tenant_created", table_name="public_order_attributions")
    op.drop_table("public_order_attributions")
    op.drop_column("configuracoes_restaurante", "delivery_allowed_neighborhoods")
    op.drop_column("configuracoes_restaurante", "delivery_allowed_cities")
    op.drop_column("configuracoes_restaurante", "delivery_area_restriction_enabled")
