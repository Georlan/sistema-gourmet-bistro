"""add saas_commercial_grants table for auditable Founders program with RLS

Revision ID: 20261126c104
Revises: 20261125c103
Create Date: 2026-11-26 00:15:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261126c104"
down_revision: Union[str, Sequence[str], None] = "20261125c103"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "saas_commercial_grants" not in inspector.get_table_names():
        op.create_table(
            "saas_commercial_grants",
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column(
                "restaurante_id",
                sa.Integer(),
                sa.ForeignKey("restaurantes.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("cohort_code", sa.String(length=32), nullable=False, server_default="founders_5"),
            sa.Column("fixed_monthly_price", sa.Numeric(12, 2), nullable=False),
            sa.Column("free_addon_licenses", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.Column("granted_by", sa.String(length=64), nullable=False),
            sa.Column("reason", sa.Text(), nullable=False),
            sa.Column(
                "granted_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
            sa.Column("revoked_by", sa.String(length=64), nullable=True),
            sa.Column("revoke_reason", sa.Text(), nullable=True),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            sa.CheckConstraint(
                "cohort_code IN ('founders_5')",
                name="ck_saas_commercial_grants_cohort",
            ),
            sa.CheckConstraint(
                "fixed_monthly_price >= 0",
                name="ck_saas_commercial_grants_price",
            ),
        )
        op.create_index(
            "ix_saas_commercial_grants_restaurante_id",
            "saas_commercial_grants",
            ["restaurante_id"],
            unique=False,
        )
        op.create_index(
            "ix_saas_commercial_grants_active",
            "saas_commercial_grants",
            ["active"],
            unique=False,
        )
        op.create_index(
            "uq_saas_commercial_grants_active_tenant_cohort",
            "saas_commercial_grants",
            ["restaurante_id", "cohort_code"],
            unique=True,
            postgresql_where=sa.text("active IS TRUE"),
            sqlite_where=sa.text("active = 1"),
        )

    if bind.dialect.name != "postgresql":
        return

    tenant_expr = (
        "restaurante_id = (SELECT NULLIF("
        "current_setting('app.current_restaurante_id', true), ''"
        ")::integer)"
    )
    op.execute("ALTER TABLE public.saas_commercial_grants ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.saas_commercial_grants FORCE ROW LEVEL SECURITY")
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'koma_app') THEN
                REVOKE ALL ON TABLE public.saas_commercial_grants FROM koma_app;
                GRANT SELECT, INSERT, UPDATE ON TABLE public.saas_commercial_grants TO koma_app;
            END IF;
        END
        $$;
    """)
    op.execute(f"""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE schemaname = 'public' AND tablename = 'saas_commercial_grants'
                  AND policyname = 'saas_commercial_grants_tenant_select'
            ) THEN
                CREATE POLICY saas_commercial_grants_tenant_select
                ON public.saas_commercial_grants FOR SELECT TO koma_app USING ({tenant_expr});
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE schemaname = 'public' AND tablename = 'saas_commercial_grants'
                  AND policyname = 'saas_commercial_grants_tenant_insert'
            ) THEN
                CREATE POLICY saas_commercial_grants_tenant_insert
                ON public.saas_commercial_grants FOR INSERT TO koma_app WITH CHECK ({tenant_expr});
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE schemaname = 'public' AND tablename = 'saas_commercial_grants'
                  AND policyname = 'saas_commercial_grants_tenant_update'
            ) THEN
                CREATE POLICY saas_commercial_grants_tenant_update
                ON public.saas_commercial_grants FOR UPDATE TO koma_app
                USING ({tenant_expr}) WITH CHECK ({tenant_expr});
            END IF;
        END
        $$;
    """)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        for policy_name in (
            "saas_commercial_grants_tenant_update",
            "saas_commercial_grants_tenant_insert",
            "saas_commercial_grants_tenant_select",
        ):
            op.execute(f"DROP POLICY IF EXISTS {policy_name} ON public.saas_commercial_grants")

    inspector = sa.inspect(bind)
    if "saas_commercial_grants" in inspector.get_table_names():
        op.drop_index("uq_saas_commercial_grants_active_tenant_cohort", table_name="saas_commercial_grants")
        op.drop_index("ix_saas_commercial_grants_active", table_name="saas_commercial_grants")
        op.drop_index("ix_saas_commercial_grants_restaurante_id", table_name="saas_commercial_grants")
        op.drop_table("saas_commercial_grants")
