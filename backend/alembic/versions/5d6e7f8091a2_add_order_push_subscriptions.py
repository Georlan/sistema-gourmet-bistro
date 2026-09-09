"""add order push subscriptions

Revision ID: 5d6e7f8091a2
Revises: 4c5d6e7f8091
Create Date: 2026-09-08 22:10:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "5d6e7f8091a2"
down_revision = "4c5d6e7f8091"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()

    op.create_table(
        "order_push_subscriptions",
        sa.Column("id", sa.String(length=36), primary_key=True, nullable=False),
        sa.Column("restaurante_id", sa.Integer(), nullable=False),
        sa.Column("conversation_id", sa.String(length=36), nullable=False),
        sa.Column("pedido_id", sa.String(length=64), nullable=False),
        sa.Column("endpoint_hash", sa.String(length=64), nullable=False),
        sa.Column("endpoint_ciphertext", sa.Text(), nullable=False),
        sa.Column("p256dh_ciphertext", sa.Text(), nullable=False),
        sa.Column("auth_ciphertext", sa.Text(), nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["restaurante_id"],
            ["restaurantes.id"],
            name="fk_order_push_subscriptions_restaurante_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["conversation_id"],
            ["order_conversations.id"],
            name="fk_order_push_subscriptions_conversation_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["pedido_id"],
            ["comandas.id"],
            name="fk_order_push_subscriptions_pedido_id",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "conversation_id",
            "endpoint_hash",
            name="uq_order_push_subscriptions_conv_endpoint",
        ),
    )
    op.create_index(
        "ix_order_push_subscriptions_tenant_order",
        "order_push_subscriptions",
        ["restaurante_id", "pedido_id"],
        unique=False,
    )
    op.create_index(
        "ix_order_push_subscriptions_endpoint_hash",
        "order_push_subscriptions",
        ["endpoint_hash"],
        unique=False,
    )
    op.create_index(
        "ix_order_push_subscriptions_restaurante_id",
        "order_push_subscriptions",
        ["restaurante_id"],
        unique=False,
    )
    op.create_index(
        "ix_order_push_subscriptions_conversation_id",
        "order_push_subscriptions",
        ["conversation_id"],
        unique=False,
    )
    op.create_index(
        "ix_order_push_subscriptions_pedido_id",
        "order_push_subscriptions",
        ["pedido_id"],
        unique=False,
    )

    if bind.dialect.name != "postgresql":
        return

    tenant_expr = (
        "restaurante_id = NULLIF("
        "current_setting('app.current_restaurante_id', true), ''"
        ")::integer"
    )

    op.execute("ALTER TABLE public.order_push_subscriptions ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.order_push_subscriptions FORCE ROW LEVEL SECURITY")
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'koma_app') THEN
                REVOKE ALL ON TABLE public.order_push_subscriptions FROM PUBLIC;
                REVOKE ALL ON TABLE public.order_push_subscriptions FROM koma_app;
                GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.order_push_subscriptions TO koma_app;
            END IF;
        END
        $$;
    """)

    op.execute(f"""
        CREATE POLICY order_push_subscriptions_select
        ON public.order_push_subscriptions
        FOR SELECT TO koma_app
        USING ({tenant_expr})
    """)
    op.execute(f"""
        CREATE POLICY order_push_subscriptions_insert
        ON public.order_push_subscriptions
        FOR INSERT TO koma_app
        WITH CHECK ({tenant_expr})
    """)
    op.execute(f"""
        CREATE POLICY order_push_subscriptions_update
        ON public.order_push_subscriptions
        FOR UPDATE TO koma_app
        USING ({tenant_expr})
        WITH CHECK ({tenant_expr})
    """)
    op.execute(f"""
        CREATE POLICY order_push_subscriptions_delete
        ON public.order_push_subscriptions
        FOR DELETE TO koma_app
        USING ({tenant_expr})
    """)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("DROP POLICY IF EXISTS order_push_subscriptions_delete ON public.order_push_subscriptions")
        op.execute("DROP POLICY IF EXISTS order_push_subscriptions_update ON public.order_push_subscriptions")
        op.execute("DROP POLICY IF EXISTS order_push_subscriptions_insert ON public.order_push_subscriptions")
        op.execute("DROP POLICY IF EXISTS order_push_subscriptions_select ON public.order_push_subscriptions")
    op.drop_table("order_push_subscriptions")
