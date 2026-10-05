"""Add privacy-safe acquisition attribution for public cardapio orders.

Revision ID: b4c8d9e0f1a2
Revises: a3af4de4e221
Create Date: 2026-10-05
"""

from alembic import op
import sqlalchemy as sa


revision = "b4c8d9e0f1a2"
down_revision = "a3af4de4e221"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "order_acquisition_attributions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column(
            "restaurante_id",
            sa.Integer(),
            sa.ForeignKey("restaurantes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "comanda_id",
            sa.String(),
            sa.ForeignKey("comandas.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("session_id", sa.String(length=80), nullable=False),
        sa.Column("source", sa.String(length=160), nullable=True),
        sa.Column("medium", sa.String(length=160), nullable=True),
        sa.Column("campaign", sa.String(length=160), nullable=True),
        sa.Column("content", sa.String(length=160), nullable=True),
        sa.Column("term", sa.String(length=160), nullable=True),
        sa.Column("referrer", sa.String(length=300), nullable=True),
        sa.Column("landing_path", sa.String(length=300), nullable=True),
        sa.Column("client_surface", sa.String(length=80), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "restaurante_id",
            "comanda_id",
            name="uq_order_acquisition_tenant_order",
        ),
    )
    op.create_index(
        "ix_order_acquisition_tenant_created",
        "order_acquisition_attributions",
        ["restaurante_id", "created_at"],
    )
    op.create_index(
        "ix_order_acquisition_attributions_restaurante_id",
        "order_acquisition_attributions",
        ["restaurante_id"],
    )
    op.create_index(
        "ix_order_acquisition_attributions_comanda_id",
        "order_acquisition_attributions",
        ["comanda_id"],
    )

    if op.get_bind().dialect.name != "postgresql":
        return

    op.execute(
        "ALTER TABLE public.order_acquisition_attributions ENABLE ROW LEVEL SECURITY"
    )
    op.execute(
        "ALTER TABLE public.order_acquisition_attributions FORCE ROW LEVEL SECURITY"
    )
    op.execute(
        """
        CREATE POLICY order_acquisition_attributions_tenant
        ON public.order_acquisition_attributions
        USING (
            restaurante_id = COALESCE(
                NULLIF(current_setting('app.current_restaurante_id', true), ''),
                '0'
            )::integer
        )
        WITH CHECK (
            restaurante_id = COALESCE(
                NULLIF(current_setting('app.current_restaurante_id', true), ''),
                '0'
            )::integer
        )
        """
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'koma_app') THEN
                GRANT SELECT, INSERT ON public.order_acquisition_attributions TO koma_app;
            END IF;
        END
        $$
        """
    )


def downgrade() -> None:
    op.drop_index(
        "ix_order_acquisition_attributions_comanda_id",
        table_name="order_acquisition_attributions",
    )
    op.drop_index(
        "ix_order_acquisition_attributions_restaurante_id",
        table_name="order_acquisition_attributions",
    )
    op.drop_index(
        "ix_order_acquisition_tenant_created",
        table_name="order_acquisition_attributions",
    )
    op.drop_table("order_acquisition_attributions")
