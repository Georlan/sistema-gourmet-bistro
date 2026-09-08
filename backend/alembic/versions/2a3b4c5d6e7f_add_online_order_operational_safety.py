"""add online order operational safety

Revision ID: 2a3b4c5d6e7f
Revises: 1f2e3d4c5b6a
Create Date: 2026-09-08 02:35:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "2a3b4c5d6e7f"
down_revision = "1f2e3d4c5b6a"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()

    op.create_table(
        "online_order_controls",
        sa.Column("restaurante_id", sa.Integer(), nullable=False),
        sa.Column("paused", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("pause_reason", sa.String(length=160), nullable=True),
        sa.Column("pause_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("max_active_orders", sa.Integer(), nullable=True),
        sa.Column("auto_pause", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("paused_by_user_id", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint(
            "max_active_orders IS NULL OR max_active_orders BETWEEN 1 AND 500",
            name="ck_online_order_controls_capacity",
        ),
        sa.ForeignKeyConstraint(
            ["restaurante_id"], ["restaurantes.id"],
            name="fk_online_order_controls_restaurante_id", ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["paused_by_user_id"], ["usuarios.id"],
            name="fk_online_order_controls_paused_by_user_id", ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("restaurante_id", name="pk_online_order_controls"),
    )

    op.create_table(
        "online_order_customer_blocks",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("restaurante_id", sa.Integer(), nullable=False),
        sa.Column("cliente_id", sa.String(), nullable=True),
        sa.Column("phone_hash", sa.String(length=64), nullable=True),
        sa.Column("reason", sa.String(length=240), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_by_user_id", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint(
            "cliente_id IS NOT NULL OR phone_hash IS NOT NULL",
            name="ck_online_order_customer_blocks_identity",
        ),
        sa.ForeignKeyConstraint(
            ["restaurante_id"], ["restaurantes.id"],
            name="fk_online_order_customer_blocks_restaurante_id", ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["cliente_id"], ["clientes.id"],
            name="fk_online_order_customer_blocks_cliente_id", ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"], ["usuarios.id"],
            name="fk_online_order_customer_blocks_created_by_user_id", ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_online_order_customer_blocks"),
    )
    op.create_index(
        "ix_online_order_customer_blocks_tenant_phone",
        "online_order_customer_blocks",
        ["restaurante_id", "phone_hash", "active"],
    )
    op.create_index(
        "ix_online_order_customer_blocks_tenant_customer",
        "online_order_customer_blocks",
        ["restaurante_id", "cliente_id", "active"],
    )

    op.create_table(
        "online_order_operational_audit",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("restaurante_id", sa.Integer(), nullable=False),
        sa.Column("actor_user_id", sa.String(), nullable=True),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("before_data", sa.JSON(), nullable=True),
        sa.Column("after_data", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(
            ["restaurante_id"], ["restaurantes.id"],
            name="fk_online_order_operational_audit_restaurante_id", ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["actor_user_id"], ["usuarios.id"],
            name="fk_online_order_operational_audit_actor_user_id", ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_online_order_operational_audit"),
    )
    op.create_index(
        "ix_online_order_operational_audit_tenant_created",
        "online_order_operational_audit",
        ["restaurante_id", "created_at"],
    )

    if bind.dialect.name != "postgresql":
        return

    tenant_expr = (
        "restaurante_id = NULLIF("
        "current_setting('app.current_restaurante_id', true), ''"
        ")::integer"
    )
    for table in (
        "online_order_controls",
        "online_order_customer_blocks",
        "online_order_operational_audit",
    ):
        op.execute(f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE public.{table} FORCE ROW LEVEL SECURITY")

    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'koma_app') THEN
                REVOKE ALL ON TABLE public.online_order_controls FROM PUBLIC;
                REVOKE ALL ON TABLE public.online_order_controls FROM koma_app;
                GRANT SELECT, INSERT, UPDATE ON TABLE public.online_order_controls TO koma_app;

                REVOKE ALL ON TABLE public.online_order_customer_blocks FROM PUBLIC;
                REVOKE ALL ON TABLE public.online_order_customer_blocks FROM koma_app;
                GRANT SELECT, INSERT, UPDATE ON TABLE public.online_order_customer_blocks TO koma_app;

                REVOKE ALL ON TABLE public.online_order_operational_audit FROM PUBLIC;
                REVOKE ALL ON TABLE public.online_order_operational_audit FROM koma_app;
                GRANT SELECT, INSERT ON TABLE public.online_order_operational_audit TO koma_app;

                IF to_regclass('public.online_order_operational_audit_id_seq') IS NOT NULL THEN
                    REVOKE ALL ON SEQUENCE public.online_order_operational_audit_id_seq FROM PUBLIC;
                    REVOKE ALL ON SEQUENCE public.online_order_operational_audit_id_seq FROM koma_app;
                    GRANT USAGE, SELECT ON SEQUENCE public.online_order_operational_audit_id_seq TO koma_app;
                END IF;
            END IF;
        END
        $$;
    """)

    for table in (
        "online_order_controls",
        "online_order_customer_blocks",
        "online_order_operational_audit",
    ):
        op.execute(f"""
            CREATE POLICY {table}_select
            ON public.{table}
            FOR SELECT TO koma_app
            USING ({tenant_expr})
        """)
        op.execute(f"""
            CREATE POLICY {table}_insert
            ON public.{table}
            FOR INSERT TO koma_app
            WITH CHECK ({tenant_expr})
        """)

    for table in ("online_order_controls", "online_order_customer_blocks"):
        op.execute(f"""
            CREATE POLICY {table}_update
            ON public.{table}
            FOR UPDATE TO koma_app
            USING ({tenant_expr})
            WITH CHECK ({tenant_expr})
        """)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        for table in (
            "online_order_controls",
            "online_order_customer_blocks",
            "online_order_operational_audit",
        ):
            op.execute(f"DROP POLICY IF EXISTS {table}_update ON public.{table}")
            op.execute(f"DROP POLICY IF EXISTS {table}_insert ON public.{table}")
            op.execute(f"DROP POLICY IF EXISTS {table}_select ON public.{table}")

    op.drop_table("online_order_operational_audit")
    op.drop_table("online_order_customer_blocks")
    op.drop_table("online_order_controls")
