"""add assisted catalog requests

Revision ID: e05b7c9d1f34
Revises: df4a6b8c0e23
Create Date: 2026-09-13 23:05:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "e05b7c9d1f34"
down_revision = "df4a6b8c0e23"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()

    op.create_table(
        "catalog_assistance_requests",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("restaurante_id", sa.Integer(), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=100), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("file_sha256", sa.String(length=64), nullable=False),
        sa.Column("file_content", sa.LargeBinary(), nullable=False),
        sa.Column("status", sa.String(length=20), server_default="pending", nullable=False),
        sa.Column("operator_note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["restaurante_id"],
            ["restaurantes.id"],
            name="fk_catalog_assistance_restaurante_id",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'processing', 'completed', 'cancelled', 'superseded')",
            name="ck_catalog_assistance_requests_status",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_catalog_assistance_tenant_status_created",
        "catalog_assistance_requests",
        ["restaurante_id", "status", "created_at"],
        unique=False,
    )

    if bind.dialect.name != "postgresql":
        return

    tenant_expr = (
        "restaurante_id = NULLIF("
        "current_setting('app.current_restaurante_id', true), ''"
        ")::integer"
    )
    op.execute("ALTER TABLE public.catalog_assistance_requests ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.catalog_assistance_requests FORCE ROW LEVEL SECURITY")
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'koma_app') THEN
                REVOKE ALL ON TABLE public.catalog_assistance_requests FROM koma_app;
                GRANT SELECT, INSERT, UPDATE ON TABLE public.catalog_assistance_requests TO koma_app;
            END IF;
        END
        $$;
    """)
    op.execute(f"""
        CREATE POLICY catalog_assistance_select
        ON public.catalog_assistance_requests
        FOR SELECT
        TO koma_app
        USING ({tenant_expr})
    """)
    op.execute(f"""
        CREATE POLICY catalog_assistance_insert
        ON public.catalog_assistance_requests
        FOR INSERT
        TO koma_app
        WITH CHECK ({tenant_expr})
    """)
    op.execute(f"""
        CREATE POLICY catalog_assistance_update
        ON public.catalog_assistance_requests
        FOR UPDATE
        TO koma_app
        USING ({tenant_expr})
        WITH CHECK ({tenant_expr})
    """)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("DROP POLICY IF EXISTS catalog_assistance_update ON public.catalog_assistance_requests")
        op.execute("DROP POLICY IF EXISTS catalog_assistance_insert ON public.catalog_assistance_requests")
        op.execute("DROP POLICY IF EXISTS catalog_assistance_select ON public.catalog_assistance_requests")

    op.drop_index(
        "ix_catalog_assistance_tenant_status_created",
        table_name="catalog_assistance_requests",
    )
    op.drop_table("catalog_assistance_requests")
