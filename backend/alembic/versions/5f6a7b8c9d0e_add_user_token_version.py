"""add user token version

Revision ID: 5f6a7b8c9d0e
Revises: 4e5f6a7b8c9d
Create Date: 2026-09-03 16:20:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "5f6a7b8c9d0e"
down_revision = "4e5f6a7b8c9d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()

    op.create_table(
        "user_session_versions",
        sa.Column("user_id", sa.String(), primary_key=True, nullable=False),
        sa.Column("restaurante_id", sa.Integer(), nullable=False),
        sa.Column(
            "token_version",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("1"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["usuarios.id"],
            name="fk_user_session_versions_user_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["restaurante_id"],
            ["restaurantes.id"],
            name="fk_user_session_versions_restaurante_id",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "token_version >= 1",
            name="ck_user_session_versions_positive",
        ),
        sa.UniqueConstraint(
            "restaurante_id",
            "user_id",
            name="uq_user_session_versions_tenant_user",
        ),
    )
    op.create_index(
        "ix_user_session_versions_tenant_user",
        "user_session_versions",
        ["restaurante_id", "user_id"],
        unique=False,
    )

    if bind.dialect.name != "postgresql":
        return

    tenant_expr = (
        "restaurante_id = NULLIF("
        "current_setting('app.current_restaurante_id', true), ''"
        ")::integer"
    )
    op.execute("ALTER TABLE public.user_session_versions ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.user_session_versions FORCE ROW LEVEL SECURITY")
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'koma_app') THEN
                REVOKE ALL ON TABLE public.user_session_versions FROM koma_app;
                GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_session_versions TO koma_app;
            END IF;
        END
        $$;
    """)
    op.execute(f"""
        CREATE POLICY user_session_versions_select
        ON public.user_session_versions
        FOR SELECT TO koma_app
        USING ({tenant_expr})
    """)
    op.execute(f"""
        CREATE POLICY user_session_versions_insert
        ON public.user_session_versions
        FOR INSERT TO koma_app
        WITH CHECK ({tenant_expr})
    """)
    op.execute(f"""
        CREATE POLICY user_session_versions_update
        ON public.user_session_versions
        FOR UPDATE TO koma_app
        USING ({tenant_expr})
        WITH CHECK ({tenant_expr})
    """)
    op.execute(f"""
        CREATE POLICY user_session_versions_delete
        ON public.user_session_versions
        FOR DELETE TO koma_app
        USING ({tenant_expr})
    """)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("DROP POLICY IF EXISTS user_session_versions_delete ON public.user_session_versions")
        op.execute("DROP POLICY IF EXISTS user_session_versions_update ON public.user_session_versions")
        op.execute("DROP POLICY IF EXISTS user_session_versions_insert ON public.user_session_versions")
        op.execute("DROP POLICY IF EXISTS user_session_versions_select ON public.user_session_versions")

    op.drop_index(
        "ix_user_session_versions_tenant_user",
        table_name="user_session_versions",
    )
    op.drop_table("user_session_versions")
