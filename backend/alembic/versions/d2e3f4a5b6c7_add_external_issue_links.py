"""add external_issue_links table with rls

Revision ID: d2e3f4a5b6c7
Revises: c1d2e3f4a5b6
Create Date: 2026-10-06

"""
from alembic import op
import sqlalchemy as sa

revision = "d2e3f4a5b6c7"
down_revision = "c1d2e3f4a5b6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    op.create_table(
        "external_issue_links",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("restaurante_id", sa.Integer(), nullable=False),
        sa.Column("provider", sa.String(length=32), server_default="linear", nullable=False),
        sa.Column("external_issue_id", sa.String(length=128), nullable=False),
        sa.Column("external_identifier", sa.String(length=64), nullable=False),
        sa.Column("external_url", sa.String(length=512), nullable=False),
        sa.Column("title_snapshot", sa.String(length=255), nullable=False),
        sa.Column("status_snapshot", sa.String(length=64), nullable=True),
        sa.Column("priority_snapshot", sa.String(length=32), nullable=True),
        sa.Column("actor", sa.String(length=255), nullable=False),
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
            name="fk_external_issue_links_restaurante_id",
            ondelete="CASCADE",
        ),
    )

    op.create_index(
        "ix_external_issue_links_tenant_created",
        "external_issue_links",
        ["restaurante_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_external_issue_links_identifier",
        "external_issue_links",
        ["external_identifier"],
        unique=False,
    )

    if bind.dialect.name != "postgresql":
        return

    tenant_expr = (
        "restaurante_id = NULLIF("
        "current_setting('app.current_restaurante_id', true), ''"
        ")::integer"
    )

    op.execute("ALTER TABLE public.external_issue_links ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.external_issue_links FORCE ROW LEVEL SECURITY")

    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'koma_app') THEN
                REVOKE ALL ON TABLE public.external_issue_links FROM koma_app;
                GRANT SELECT, INSERT, UPDATE ON TABLE public.external_issue_links TO koma_app;
                GRANT USAGE, SELECT ON SEQUENCE public.external_issue_links_id_seq TO koma_app;
            END IF;
        END
        $$;
    """)

    op.execute(f"""
        CREATE POLICY external_issue_links_select
        ON public.external_issue_links
        FOR SELECT
        TO koma_app
        USING ({tenant_expr})
    """)
    op.execute(f"""
        CREATE POLICY external_issue_links_insert
        ON public.external_issue_links
        FOR INSERT
        TO koma_app
        WITH CHECK ({tenant_expr})
    """)
    op.execute(f"""
        CREATE POLICY external_issue_links_update
        ON public.external_issue_links
        FOR UPDATE
        TO koma_app
        USING ({tenant_expr})
        WITH CHECK ({tenant_expr})
    """)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("DROP POLICY IF EXISTS external_issue_links_update ON public.external_issue_links")
        op.execute("DROP POLICY IF EXISTS external_issue_links_insert ON public.external_issue_links")
        op.execute("DROP POLICY IF EXISTS external_issue_links_select ON public.external_issue_links")

    op.drop_index("ix_external_issue_links_identifier", table_name="external_issue_links")
    op.drop_index("ix_external_issue_links_tenant_created", table_name="external_issue_links")
    op.drop_table("external_issue_links")
