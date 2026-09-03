"""add support sessions table with rls

Revision ID: 6a7b8c9d0e1f
Revises: 5f6a7b8c9d0e
Create Date: 2026-09-03 17:15:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "6a7b8c9d0e1f"
down_revision = "5f6a7b8c9d0e"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()

    op.create_table(
        "support_sessions",
        sa.Column("id", sa.String(length=64), primary_key=True, nullable=False),
        sa.Column("restaurante_id", sa.Integer(), nullable=False),
        sa.Column("operator", sa.String(length=255), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("duration_minutes", sa.Integer(), nullable=False, server_default=sa.text("30")),
        sa.Column("token_jti", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="active"),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(
            ["restaurante_id"],
            ["restaurantes.id"],
            name="fk_support_sessions_restaurante_id",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "status IN ('active', 'ended', 'expired')",
            name="ck_support_sessions_status",
        ),
        sa.CheckConstraint(
            "duration_minutes >= 1 AND duration_minutes <= 120",
            name="ck_support_sessions_duration",
        ),
        sa.UniqueConstraint(
            "token_jti",
            name="uq_support_sessions_token_jti",
        ),
    )
    op.create_index(
        "ix_support_sessions_tenant_status",
        "support_sessions",
        ["restaurante_id", "status"],
        unique=False,
    )
    op.create_index(
        "ix_support_sessions_token_jti",
        "support_sessions",
        ["token_jti"],
        unique=False,
    )

    if bind.dialect.name != "postgresql":
        return

    tenant_expr = (
        "restaurante_id = NULLIF("
        "current_setting('app.current_restaurante_id', true), ''"
        ")::integer"
    )
    op.execute("ALTER TABLE public.support_sessions ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.support_sessions FORCE ROW LEVEL SECURITY")
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'koma_app') THEN
                REVOKE ALL ON TABLE public.support_sessions FROM koma_app;
                GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.support_sessions TO koma_app;
            END IF;
        END
        $$;
    """)
    op.execute(f"""
        CREATE POLICY support_sessions_select
        ON public.support_sessions
        FOR SELECT TO koma_app
        USING ({tenant_expr})
    """)
    op.execute(f"""
        CREATE POLICY support_sessions_insert
        ON public.support_sessions
        FOR INSERT TO koma_app
        WITH CHECK ({tenant_expr})
    """)
    op.execute(f"""
        CREATE POLICY support_sessions_update
        ON public.support_sessions
        FOR UPDATE TO koma_app
        USING ({tenant_expr})
        WITH CHECK ({tenant_expr})
    """)
    op.execute(f"""
        CREATE POLICY support_sessions_delete
        ON public.support_sessions
        FOR DELETE TO koma_app
        USING ({tenant_expr})
    """)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("DROP POLICY IF EXISTS support_sessions_select ON public.support_sessions")
        op.execute("DROP POLICY IF EXISTS support_sessions_insert ON public.support_sessions")
        op.execute("DROP POLICY IF EXISTS support_sessions_update ON public.support_sessions")
        op.execute("DROP POLICY IF EXISTS support_sessions_delete ON public.support_sessions")

    op.drop_index("ix_support_sessions_token_jti", table_name="support_sessions")
    op.drop_index("ix_support_sessions_tenant_status", table_name="support_sessions")
    op.drop_table("support_sessions")
