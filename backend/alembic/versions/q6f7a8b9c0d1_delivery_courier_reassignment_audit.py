"""add immutable audit for courier reassignment after dispatch

Revision ID: q6f7a8b9c0d1
Revises: p5e6f7a8b9c0
Create Date: 2026-09-25
"""

from alembic import op
import sqlalchemy as sa


revision = "q6f7a8b9c0d1"
down_revision = "p5e6f7a8b9c0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()

    op.create_table(
        "delivery_courier_reassignment_audit",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("restaurante_id", sa.Integer(), nullable=False),
        sa.Column("comanda_id", sa.String(), nullable=False),
        sa.Column("previous_motoboy_id", sa.Integer(), nullable=True),
        sa.Column("new_motoboy_id", sa.Integer(), nullable=True),
        sa.Column("previous_motoboy_name", sa.String(), nullable=False),
        sa.Column("new_motoboy_name", sa.String(), nullable=False),
        sa.Column("actor_user_id", sa.String(), nullable=True),
        sa.Column("actor_name", sa.String(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(
            ["restaurante_id"],
            ["restaurantes.id"],
            name="fk_delivery_courier_reassignment_restaurante",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["comanda_id"],
            ["comandas.id"],
            name="fk_delivery_courier_reassignment_comanda",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["previous_motoboy_id"],
            ["motoboys.id"],
            name="fk_delivery_courier_reassignment_previous_motoboy",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["new_motoboy_id"],
            ["motoboys.id"],
            name="fk_delivery_courier_reassignment_new_motoboy",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["actor_user_id"],
            ["usuarios.id"],
            name="fk_delivery_courier_reassignment_actor",
            ondelete="SET NULL",
        ),
        sa.CheckConstraint(
            "length(trim(reason)) >= 3",
            name="ck_delivery_courier_reassignment_reason",
        ),
    )
    op.create_index(
        "ix_delivery_courier_reassignment_tenant_order_created",
        "delivery_courier_reassignment_audit",
        ["restaurante_id", "comanda_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_delivery_courier_reassignment_audit_restaurante_id",
        "delivery_courier_reassignment_audit",
        ["restaurante_id"],
        unique=False,
    )
    op.create_index(
        "ix_delivery_courier_reassignment_audit_comanda_id",
        "delivery_courier_reassignment_audit",
        ["comanda_id"],
        unique=False,
    )

    if bind.dialect.name != "postgresql":
        return

    tenant_expr = (
        "restaurante_id = NULLIF("
        "current_setting('app.current_restaurante_id', true), ''"
        ")::integer"
    )
    op.execute(
        "ALTER TABLE public.delivery_courier_reassignment_audit "
        "ENABLE ROW LEVEL SECURITY"
    )
    op.execute(
        "ALTER TABLE public.delivery_courier_reassignment_audit "
        "FORCE ROW LEVEL SECURITY"
    )
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'koma_app') THEN
                REVOKE ALL ON TABLE public.delivery_courier_reassignment_audit FROM koma_app;
                GRANT SELECT, INSERT ON TABLE public.delivery_courier_reassignment_audit TO koma_app;
                IF to_regclass('public.delivery_courier_reassignment_audit_id_seq') IS NOT NULL THEN
                    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE public.delivery_courier_reassignment_audit_id_seq TO koma_app';
                END IF;
            END IF;
        END
        $$;
    """)
    op.execute(f"""
        CREATE POLICY delivery_courier_reassignment_select
        ON public.delivery_courier_reassignment_audit
        FOR SELECT TO koma_app
        USING ({tenant_expr})
    """)
    op.execute(f"""
        CREATE POLICY delivery_courier_reassignment_insert
        ON public.delivery_courier_reassignment_audit
        FOR INSERT TO koma_app
        WITH CHECK ({tenant_expr})
    """)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(
            "DROP POLICY IF EXISTS delivery_courier_reassignment_select "
            "ON public.delivery_courier_reassignment_audit"
        )
        op.execute(
            "DROP POLICY IF EXISTS delivery_courier_reassignment_insert "
            "ON public.delivery_courier_reassignment_audit"
        )

    op.drop_index(
        "ix_delivery_courier_reassignment_audit_comanda_id",
        table_name="delivery_courier_reassignment_audit",
    )
    op.drop_index(
        "ix_delivery_courier_reassignment_audit_restaurante_id",
        table_name="delivery_courier_reassignment_audit",
    )
    op.drop_index(
        "ix_delivery_courier_reassignment_tenant_order_created",
        table_name="delivery_courier_reassignment_audit",
    )
    op.drop_table("delivery_courier_reassignment_audit")
