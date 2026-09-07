"""add order conversations and chat

Revision ID: 0e1f2a3b4c5d
Revises: fc3d4e5f6a7b
Create Date: 2026-09-07 13:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "0e1f2a3b4c5d"
down_revision = "fc3d4e5f6a7b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()

    # 1. Tabela de conversas de pedidos
    op.create_table(
        "order_conversations",
        sa.Column("id", sa.String(length=36), primary_key=True, nullable=False),
        sa.Column("restaurante_id", sa.Integer(), nullable=False),
        sa.Column("pedido_id", sa.String(length=64), nullable=False),
        sa.Column("public_access_token_hash", sa.String(length=64), nullable=False),
        sa.Column("customer_last_read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("staff_last_read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["restaurante_id"],
            ["restaurantes.id"],
            name="fk_order_conversations_restaurante_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["pedido_id"],
            ["comandas.id"],
            name="fk_order_conversations_pedido_id",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("restaurante_id", "pedido_id", name="uq_order_conversations_tenant_pedido"),
        sa.UniqueConstraint("public_access_token_hash", name="uq_order_conversations_token_hash"),
    )
    op.create_index(
        "ix_order_conversations_token_hash",
        "order_conversations",
        ["public_access_token_hash"],
        unique=True,
    )
    op.create_index(
        "ix_order_conversations_tenant_updated",
        "order_conversations",
        ["restaurante_id", "updated_at"],
        unique=False,
    )
    op.create_index(
        "ix_order_conversations_pedido_id",
        "order_conversations",
        ["pedido_id"],
        unique=False,
    )

    # 2. Tabela de mensagens de pedidos
    op.create_table(
        "order_messages",
        sa.Column("id", sa.String(length=36), primary_key=True, nullable=False),
        sa.Column("restaurante_id", sa.Integer(), nullable=False),
        sa.Column("conversation_id", sa.String(length=36), nullable=False),
        sa.Column("pedido_id", sa.String(length=64), nullable=False),
        sa.Column("sender_type", sa.String(length=20), nullable=False),
        sa.Column("sender_user_id", sa.String(), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("event_key", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["restaurante_id"],
            ["restaurantes.id"],
            name="fk_order_messages_restaurante_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["conversation_id"],
            ["order_conversations.id"],
            name="fk_order_messages_conversation_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["sender_user_id"],
            ["usuarios.id"],
            name="fk_order_messages_sender_user_id",
            ondelete="SET NULL",
        ),
        sa.CheckConstraint(
            "sender_type IN ('customer', 'staff', 'system')",
            name="ck_order_messages_sender_type",
        ),
        sa.UniqueConstraint("conversation_id", "event_key", name="uq_order_messages_conv_event_key"),
    )
    op.create_index(
        "ix_order_messages_conv_created",
        "order_messages",
        ["conversation_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_order_messages_tenant_created",
        "order_messages",
        ["restaurante_id", "created_at"],
        unique=False,
    )

    if bind.dialect.name != "postgresql":
        return

    # 3. RLS e Permissões PostgreSQL
    tenant_expr = (
        "restaurante_id = NULLIF("
        "current_setting('app.current_restaurante_id', true), ''"
        ")::integer"
    )

    op.execute("ALTER TABLE public.order_conversations ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.order_conversations FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.order_messages ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.order_messages FORCE ROW LEVEL SECURITY")

    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'koma_app') THEN
                REVOKE ALL ON TABLE public.order_conversations FROM PUBLIC;
                REVOKE ALL ON TABLE public.order_conversations FROM koma_app;
                GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.order_conversations TO koma_app;

                REVOKE ALL ON TABLE public.order_messages FROM PUBLIC;
                REVOKE ALL ON TABLE public.order_messages FROM koma_app;
                GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.order_messages TO koma_app;
            END IF;
        END
        $$;
    """)

    # Policies para order_conversations
    op.execute(f"""
        CREATE POLICY order_conversations_select
        ON public.order_conversations
        FOR SELECT
        TO koma_app
        USING ({tenant_expr})
    """)
    op.execute(f"""
        CREATE POLICY order_conversations_insert
        ON public.order_conversations
        FOR INSERT
        TO koma_app
        WITH CHECK ({tenant_expr})
    """)
    op.execute(f"""
        CREATE POLICY order_conversations_update
        ON public.order_conversations
        FOR UPDATE
        TO koma_app
        USING ({tenant_expr})
        WITH CHECK ({tenant_expr})
    """)
    op.execute(f"""
        CREATE POLICY order_conversations_delete
        ON public.order_conversations
        FOR DELETE
        TO koma_app
        USING ({tenant_expr})
    """)

    # Policies para order_messages
    op.execute(f"""
        CREATE POLICY order_messages_select
        ON public.order_messages
        FOR SELECT
        TO koma_app
        USING ({tenant_expr})
    """)
    op.execute(f"""
        CREATE POLICY order_messages_insert
        ON public.order_messages
        FOR INSERT
        TO koma_app
        WITH CHECK ({tenant_expr})
    """)
    op.execute(f"""
        CREATE POLICY order_messages_update
        ON public.order_messages
        FOR UPDATE
        TO koma_app
        USING ({tenant_expr})
        WITH CHECK ({tenant_expr})
    """)
    op.execute(f"""
        CREATE POLICY order_messages_delete
        ON public.order_messages
        FOR DELETE
        TO koma_app
        USING ({tenant_expr})
    """)

    # 4. Helper SECURITY DEFINER para resolução segura de token público
    op.execute("""
        CREATE OR REPLACE FUNCTION koma_internal.resolve_public_tracking_token(
            p_token_hash text
        )
        RETURNS TABLE(
            restaurante_id integer,
            conversation_id text,
            pedido_id text,
            closed_at timestamptz
        )
        LANGUAGE sql
        SECURITY DEFINER
        STABLE
        SET search_path = pg_catalog
        AS $$
            SELECT c.restaurante_id, c.id::text, c.pedido_id::text, c.closed_at
            FROM public.order_conversations AS c
            WHERE pg_has_role(session_user, 'koma_app', 'member')
              AND btrim(COALESCE(p_token_hash, '')) <> ''
              AND c.public_access_token_hash::text = btrim(p_token_hash)
            LIMIT 1
        $$;
    """)
    op.execute(
        "REVOKE ALL ON FUNCTION "
        "koma_internal.resolve_public_tracking_token(text) FROM PUBLIC"
    )
    op.execute(
        "GRANT EXECUTE ON FUNCTION "
        "koma_internal.resolve_public_tracking_token(text) TO koma_app"
    )


def downgrade() -> None:
    bind = op.get_bind()

    if bind.dialect.name == "postgresql":
        op.execute("DROP FUNCTION IF EXISTS koma_internal.resolve_public_tracking_token(text)")
        op.execute("DROP POLICY IF EXISTS order_messages_delete ON public.order_messages")
        op.execute("DROP POLICY IF EXISTS order_messages_update ON public.order_messages")
        op.execute("DROP POLICY IF EXISTS order_messages_insert ON public.order_messages")
        op.execute("DROP POLICY IF EXISTS order_messages_select ON public.order_messages")
        op.execute("DROP POLICY IF EXISTS order_conversations_delete ON public.order_conversations")
        op.execute("DROP POLICY IF EXISTS order_conversations_update ON public.order_conversations")
        op.execute("DROP POLICY IF EXISTS order_conversations_insert ON public.order_conversations")
        op.execute("DROP POLICY IF EXISTS order_conversations_select ON public.order_conversations")

    op.drop_table("order_messages")
    op.drop_table("order_conversations")
