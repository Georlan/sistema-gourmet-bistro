"""add support_investigations durable table with RLS

Revision ID: 20261125c103
Revises: 20261124c102
Create Date: 2026-11-25 23:05:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261125c103"
down_revision: Union[str, Sequence[str], None] = "20261124c102"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "support_investigations" not in inspector.get_table_names():
        op.create_table(
            "support_investigations",
            sa.Column("id", sa.String(length=40), primary_key=True),
            sa.Column(
                "restaurante_id",
                sa.Integer(),
                sa.ForeignKey("restaurantes.id", ondelete="CASCADE"),
                nullable=True,
            ),
            sa.Column(
                "feedback_id",
                sa.String(length=36),
                sa.ForeignKey("customer_support_feedback.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("source", sa.String(length=32), nullable=False, server_default="customer_support"),
            sa.Column("dedup_key", sa.String(length=128), nullable=False),
            sa.Column("domain", sa.String(length=48), nullable=False, server_default="geral"),
            sa.Column("severity", sa.String(length=16), nullable=False, server_default="medium"),
            sa.Column("status", sa.String(length=24), nullable=False, server_default="prepared"),
            sa.Column("evidence_status", sa.String(length=48), nullable=True),
            sa.Column("suspected_bug", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("occurrence_count", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("max_attempts", sa.Integer(), nullable=False, server_default="3"),
            sa.Column("untrusted_summary", sa.Text(), nullable=True),
            sa.Column("evidence_snapshot", sa.JSON(), nullable=True),
            sa.Column("initial_diagnosis", sa.JSON(), nullable=True),
            sa.Column("agent_result", sa.JSON(), nullable=True),
            sa.Column("last_error", sa.Text(), nullable=True),
            sa.Column(
                "last_seen_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
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
            sa.CheckConstraint(
                "source IN ('customer_support', 'availability_worker', 'manual')",
                name="ck_support_investigations_source",
            ),
            sa.CheckConstraint(
                "severity IN ('critical', 'high', 'medium', 'low')",
                name="ck_support_investigations_severity",
            ),
            sa.CheckConstraint(
                "status IN ('queued', 'collecting', 'prepared', 'analyzing', 'completed', 'failed')",
                name="ck_support_investigations_status",
            ),
            sa.CheckConstraint(
                "occurrence_count >= 1 AND attempts >= 0 AND max_attempts >= 1 AND max_attempts <= 10",
                name="ck_support_investigations_bounds",
            ),
        )
        op.create_index(
            "ix_support_investigations_restaurante_id",
            "support_investigations",
            ["restaurante_id"],
            unique=False,
        )
        op.create_index(
            "ix_support_investigations_dedup_key",
            "support_investigations",
            ["dedup_key"],
            unique=False,
        )
        op.create_index(
            "ix_support_investigations_status_created",
            "support_investigations",
            ["status", "created_at"],
            unique=False,
        )

    if bind.dialect.name != "postgresql":
        return

    tenant_expr = (
        "restaurante_id = NULLIF("
        "current_setting('app.current_restaurante_id', true), ''"
        ")::integer"
    )
    op.execute("ALTER TABLE public.support_investigations ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.support_investigations FORCE ROW LEVEL SECURITY")
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'koma_app') THEN
                REVOKE ALL ON TABLE public.support_investigations FROM koma_app;
                GRANT SELECT, INSERT, UPDATE ON TABLE public.support_investigations TO koma_app;
            END IF;
        END
        $$;
    """)
    op.execute(f"""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE schemaname = 'public' AND tablename = 'support_investigations'
                  AND policyname = 'support_investigations_tenant_select'
            ) THEN
                CREATE POLICY support_investigations_tenant_select
                ON public.support_investigations FOR SELECT TO koma_app USING ({tenant_expr});
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE schemaname = 'public' AND tablename = 'support_investigations'
                  AND policyname = 'support_investigations_tenant_insert'
            ) THEN
                CREATE POLICY support_investigations_tenant_insert
                ON public.support_investigations FOR INSERT TO koma_app WITH CHECK ({tenant_expr});
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE schemaname = 'public' AND tablename = 'support_investigations'
                  AND policyname = 'support_investigations_tenant_update'
            ) THEN
                CREATE POLICY support_investigations_tenant_update
                ON public.support_investigations FOR UPDATE TO koma_app
                USING ({tenant_expr}) WITH CHECK ({tenant_expr});
            END IF;
        END
        $$;
    """)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        for policy_name in (
            "support_investigations_tenant_update",
            "support_investigations_tenant_insert",
            "support_investigations_tenant_select",
        ):
            op.execute(
                f"DROP POLICY IF EXISTS {policy_name} ON public.support_investigations"
            )

    inspector = sa.inspect(bind)
    if "support_investigations" in inspector.get_table_names():
        op.drop_index("ix_support_investigations_status_created", table_name="support_investigations")
        op.drop_index("ix_support_investigations_dedup_key", table_name="support_investigations")
        op.drop_index("ix_support_investigations_restaurante_id", table_name="support_investigations")
        op.drop_table("support_investigations")
