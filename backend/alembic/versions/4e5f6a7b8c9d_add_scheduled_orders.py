"""add scheduled orders

Revision ID: 4e5f6a7b8c9d
Revises: 3d4e5f6a7b8c
Create Date: 2026-09-03 12:50:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "4e5f6a7b8c9d"
down_revision = "3d4e5f6a7b8c"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()

    op.create_table(
        "scheduled_orders",
        sa.Column("id", sa.String(), primary_key=True, nullable=False),
        sa.Column("restaurante_id", sa.Integer(), nullable=False),
        sa.Column("comanda_id", sa.String(), nullable=False),
        sa.Column("scheduled_for", sa.DateTime(timezone=True), nullable=False),
        sa.Column("released_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["restaurante_id"],
            ["restaurantes.id"],
            name="fk_scheduled_orders_restaurante_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["comanda_id"],
            ["comandas.id"],
            name="fk_scheduled_orders_comanda_id",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "restaurante_id",
            "comanda_id",
            name="uq_scheduled_orders_tenant_comanda",
        ),
    )
    op.create_index(
        "ix_scheduled_orders_tenant_comanda",
        "scheduled_orders",
        ["restaurante_id", "comanda_id"],
        unique=False,
    )
    op.create_index(
        "ix_scheduled_orders_due",
        "scheduled_orders",
        ["restaurante_id", "released_at", "scheduled_for"],
        unique=False,
    )

    if bind.dialect.name != "postgresql":
        return

    tenant_expr = (
        "restaurante_id = NULLIF("
        "current_setting('app.current_restaurante_id', true), ''"
        ")::integer"
    )
    op.execute("ALTER TABLE public.scheduled_orders ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.scheduled_orders FORCE ROW LEVEL SECURITY")
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'koma_app') THEN
                REVOKE ALL ON TABLE public.scheduled_orders FROM koma_app;
                GRANT SELECT, INSERT, UPDATE ON TABLE public.scheduled_orders TO koma_app;
            END IF;
        END
        $$;
    """)
    op.execute(f"""
        CREATE POLICY scheduled_orders_select
        ON public.scheduled_orders
        FOR SELECT TO koma_app
        USING ({tenant_expr})
    """)
    op.execute(f"""
        CREATE POLICY scheduled_orders_insert
        ON public.scheduled_orders
        FOR INSERT TO koma_app
        WITH CHECK ({tenant_expr})
    """)
    op.execute(f"""
        CREATE POLICY scheduled_orders_update
        ON public.scheduled_orders
        FOR UPDATE TO koma_app
        USING ({tenant_expr})
        WITH CHECK ({tenant_expr})
    """)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("DROP POLICY IF EXISTS scheduled_orders_update ON public.scheduled_orders")
        op.execute("DROP POLICY IF EXISTS scheduled_orders_insert ON public.scheduled_orders")
        op.execute("DROP POLICY IF EXISTS scheduled_orders_select ON public.scheduled_orders")

    op.drop_index("ix_scheduled_orders_due", table_name="scheduled_orders")
    op.drop_index("ix_scheduled_orders_tenant_comanda", table_name="scheduled_orders")
    op.drop_table("scheduled_orders")
