"""add canonical saas plan changes

Revision ID: g6b7c8d9e0f1
Revises: f5a6b7c8d9e0
Create Date: 2026-09-18 20:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "g6b7c8d9e0f1"
down_revision = "f5a6b7c8d9e0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "saas_plan_changes",
        sa.Column("id", sa.String(length=36), primary_key=True, nullable=False),
        sa.Column("restaurante_id", sa.Integer(), nullable=False),
        sa.Column("acceptance_id", sa.String(length=36), nullable=False),
        sa.Column("source_protocol", sa.String(length=64), nullable=False),
        sa.Column("source_plan", sa.String(length=20), nullable=False),
        sa.Column("target_plan", sa.String(length=20), nullable=False),
        sa.Column("billing_cycle", sa.String(length=16), nullable=False),
        sa.Column("target_billing_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("target_marketplace_rate", sa.Numeric(8, 6), nullable=False),
        sa.Column("pricing_version", sa.String(length=32), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column("provider_action", sa.String(length=32), nullable=False, server_default="none"),
        sa.Column("requested_by_user_id", sa.String(length=64), nullable=False),
        sa.Column("last_error_code", sa.String(length=64), nullable=True),
        sa.Column("provider_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("applied_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["restaurante_id"],
            ["restaurantes.id"],
            name="fk_saas_plan_changes_restaurante_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["acceptance_id"],
            ["contract_acceptances.id"],
            name="fk_saas_plan_changes_acceptance_id",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("acceptance_id", name="uq_saas_plan_changes_acceptance_id"),
        sa.CheckConstraint(
            "status IN ('pending', 'provider_syncing', 'provider_synced', 'applied', 'canceled')",
            name="ck_saas_plan_changes_status",
        ),
        sa.CheckConstraint(
            "provider_action IN ('none', 'update_amount', 'cancel', 'verify_pix', 'billing_setup_required')",
            name="ck_saas_plan_changes_provider_action",
        ),
        sa.CheckConstraint(
            "billing_cycle IN ('monthly', 'annual', 'mensal', 'anual')",
            name="ck_saas_plan_changes_billing_cycle",
        ),
    )
    op.create_index(
        "ix_saas_plan_changes_restaurante_id",
        "saas_plan_changes",
        ["restaurante_id"],
        unique=False,
    )
    op.create_index(
        "ix_saas_plan_changes_acceptance_id",
        "saas_plan_changes",
        ["acceptance_id"],
        unique=True,
    )
    op.create_index(
        "ix_saas_plan_changes_status",
        "saas_plan_changes",
        ["status"],
        unique=False,
    )
    op.create_index(
        "uq_saas_plan_changes_one_active_per_tenant",
        "saas_plan_changes",
        ["restaurante_id"],
        unique=True,
        postgresql_where=sa.text(
            "status IN ('pending', 'provider_syncing', 'provider_synced')"
        ),
        sqlite_where=sa.text(
            "status IN ('pending', 'provider_syncing', 'provider_synced')"
        ),
    )

    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    tenant_expr = (
        "restaurante_id = NULLIF("
        "current_setting('app.current_restaurante_id', true), ''"
        ")::integer"
    )

    op.execute("ALTER TABLE public.saas_plan_changes ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.saas_plan_changes FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'koma_app') THEN
                REVOKE ALL ON TABLE public.saas_plan_changes FROM PUBLIC;
                REVOKE ALL ON TABLE public.saas_plan_changes FROM koma_app;
                GRANT SELECT, INSERT, UPDATE ON TABLE public.saas_plan_changes TO koma_app;
            END IF;
        END
        $$;
        """
    )
    op.execute(
        f"""
        CREATE POLICY saas_plan_changes_select
        ON public.saas_plan_changes
        FOR SELECT
        TO koma_app
        USING ({tenant_expr})
        """
    )
    op.execute(
        f"""
        CREATE POLICY saas_plan_changes_insert
        ON public.saas_plan_changes
        FOR INSERT
        TO koma_app
        WITH CHECK ({tenant_expr})
        """
    )
    op.execute(
        f"""
        CREATE POLICY saas_plan_changes_update
        ON public.saas_plan_changes
        FOR UPDATE
        TO koma_app
        USING ({tenant_expr})
        WITH CHECK ({tenant_expr})
        """
    )

    op.execute(
        """
        CREATE OR REPLACE FUNCTION koma_internal.plan_change_owner_for_acceptance(
            p_acceptance_id text
        ) RETURNS integer
        LANGUAGE sql
        SECURITY DEFINER
        STABLE
        SET search_path = pg_catalog
        AS $function$
            SELECT c.restaurante_id
            FROM public.saas_plan_changes AS c
            WHERE c.acceptance_id = p_acceptance_id
            LIMIT 1
        $function$
        """
    )
    op.execute(
        "REVOKE ALL ON FUNCTION koma_internal.plan_change_owner_for_acceptance(text) FROM PUBLIC"
    )
    op.execute(
        "GRANT EXECUTE ON FUNCTION koma_internal.plan_change_owner_for_acceptance(text) TO koma_app"
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(
            "DROP FUNCTION IF EXISTS koma_internal.plan_change_owner_for_acceptance(text)"
        )
        op.execute("DROP POLICY IF EXISTS saas_plan_changes_update ON public.saas_plan_changes")
        op.execute("DROP POLICY IF EXISTS saas_plan_changes_insert ON public.saas_plan_changes")
        op.execute("DROP POLICY IF EXISTS saas_plan_changes_select ON public.saas_plan_changes")
    op.drop_table("saas_plan_changes")
