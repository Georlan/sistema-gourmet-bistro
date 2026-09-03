"""add restaurant subscriptions for Super Admin billing phase 3

Revision ID: 3c4d5e6f7a8b
Revises: 2b3c4d5e6f7a
Create Date: 2026-09-03 10:10:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "3c4d5e6f7a8b"
down_revision = "2b3c4d5e6f7a"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()

    op.create_table(
        "restaurant_subscriptions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("restaurante_id", sa.Integer(), nullable=False),
        sa.Column("plan_code", sa.String(length=32), nullable=True),
        sa.Column("billing_cycle", sa.String(length=16), nullable=True),
        sa.Column(
            "status",
            sa.String(length=24),
            server_default="not_configured",
            nullable=False,
        ),
        sa.Column("period_amount_cents", sa.Integer(), nullable=True),
        sa.Column("source", sa.String(length=16), server_default="admin", nullable=False),
        sa.Column("current_period_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["restaurante_id"],
            ["restaurantes.id"],
            name="fk_restaurant_subscriptions_restaurante_id",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "restaurante_id",
            name="uq_restaurant_subscriptions_restaurante_id",
        ),
        sa.CheckConstraint(
            "status IN ('not_configured', 'active', 'past_due', 'canceled')",
            name="ck_restaurant_subscriptions_status",
        ),
        sa.CheckConstraint(
            "billing_cycle IS NULL OR billing_cycle IN ('monthly', 'annual')",
            name="ck_restaurant_subscriptions_billing_cycle",
        ),
        sa.CheckConstraint(
            "source IN ('admin', 'provider')",
            name="ck_restaurant_subscriptions_source",
        ),
        sa.CheckConstraint(
            "period_amount_cents IS NULL OR period_amount_cents >= 0",
            name="ck_restaurant_subscriptions_period_amount",
        ),
    )
    op.create_index(
        "ix_restaurant_subscriptions_restaurante_id",
        "restaurant_subscriptions",
        ["restaurante_id"],
        unique=False,
    )

    # Não inferimos contratos de clientes existentes. Sem uma ação explícita do
    # Super Admin, o estado permanece "not_configured" e não entra no MRR.
    if bind.dialect.name != "postgresql":
        return

    tenant_expr = (
        "restaurante_id = NULLIF("
        "current_setting('app.current_restaurante_id', true), ''"
        ")::integer"
    )

    op.execute("ALTER TABLE public.restaurant_subscriptions ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.restaurant_subscriptions FORCE ROW LEVEL SECURITY")
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'koma_app') THEN
                REVOKE ALL ON TABLE public.restaurant_subscriptions FROM koma_app;
                GRANT SELECT, INSERT, UPDATE ON TABLE public.restaurant_subscriptions TO koma_app;
                GRANT USAGE, SELECT ON SEQUENCE public.restaurant_subscriptions_id_seq TO koma_app;
            END IF;
        END
        $$;
    """)
    op.execute(f"""
        CREATE POLICY restaurant_subscriptions_select
        ON public.restaurant_subscriptions
        FOR SELECT TO koma_app
        USING ({tenant_expr})
    """)
    op.execute(f"""
        CREATE POLICY restaurant_subscriptions_insert
        ON public.restaurant_subscriptions
        FOR INSERT TO koma_app
        WITH CHECK ({tenant_expr})
    """)
    op.execute(f"""
        CREATE POLICY restaurant_subscriptions_update
        ON public.restaurant_subscriptions
        FOR UPDATE TO koma_app
        USING ({tenant_expr})
        WITH CHECK ({tenant_expr})
    """)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(
            "DROP POLICY IF EXISTS restaurant_subscriptions_update "
            "ON public.restaurant_subscriptions"
        )
        op.execute(
            "DROP POLICY IF EXISTS restaurant_subscriptions_insert "
            "ON public.restaurant_subscriptions"
        )
        op.execute(
            "DROP POLICY IF EXISTS restaurant_subscriptions_select "
            "ON public.restaurant_subscriptions"
        )

    op.drop_index(
        "ix_restaurant_subscriptions_restaurante_id",
        table_name="restaurant_subscriptions",
    )
    op.drop_table("restaurant_subscriptions")
