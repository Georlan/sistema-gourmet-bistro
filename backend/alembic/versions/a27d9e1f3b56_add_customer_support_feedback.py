"""add customer support feedback

Revision ID: a27d9e1f3b56
Revises: f16c8d0e2a45
Create Date: 2026-09-14
"""

from alembic import op
import sqlalchemy as sa


revision = "a27d9e1f3b56"
down_revision = "f16c8d0e2a45"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()

    op.create_table(
        "customer_support_feedback",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("restaurante_id", sa.Integer(), nullable=False),
        sa.Column("reporter_user_id", sa.String(length=64), nullable=False),
        sa.Column("reporter_name", sa.String(length=255), nullable=True),
        sa.Column("reporter_role", sa.String(length=64), nullable=True),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("page_path", sa.String(length=300), nullable=True),
        sa.Column("status", sa.String(length=20), server_default="new", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["restaurante_id"],
            ["restaurantes.id"],
            name="fk_customer_support_feedback_restaurante_id",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "kind IN ('question', 'suggestion', 'complaint', 'problem')",
            name="ck_customer_support_feedback_kind",
        ),
        sa.CheckConstraint(
            "status IN ('new', 'read', 'resolved')",
            name="ck_customer_support_feedback_status",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_customer_support_feedback_tenant_status_created",
        "customer_support_feedback",
        ["restaurante_id", "status", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_customer_support_feedback_restaurante_id",
        "customer_support_feedback",
        ["restaurante_id"],
        unique=False,
    )

    if bind.dialect.name != "postgresql":
        return

    tenant_expr = (
        "restaurante_id = NULLIF("
        "current_setting('app.current_restaurante_id', true), ''"
        ")::integer"
    )
    op.execute("ALTER TABLE public.customer_support_feedback ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.customer_support_feedback FORCE ROW LEVEL SECURITY")
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'koma_app') THEN
                REVOKE ALL ON TABLE public.customer_support_feedback FROM koma_app;
                GRANT SELECT, INSERT ON TABLE public.customer_support_feedback TO koma_app;
            END IF;
        END
        $$;
    """)
    op.execute(f"""
        CREATE POLICY customer_support_feedback_select
        ON public.customer_support_feedback
        FOR SELECT
        TO koma_app
        USING ({tenant_expr})
    """)
    op.execute(f"""
        CREATE POLICY customer_support_feedback_insert
        ON public.customer_support_feedback
        FOR INSERT
        TO koma_app
        WITH CHECK ({tenant_expr})
    """)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(
            "DROP POLICY IF EXISTS customer_support_feedback_insert "
            "ON public.customer_support_feedback"
        )
        op.execute(
            "DROP POLICY IF EXISTS customer_support_feedback_select "
            "ON public.customer_support_feedback"
        )

    op.drop_index(
        "ix_customer_support_feedback_restaurante_id",
        table_name="customer_support_feedback",
    )
    op.drop_index(
        "ix_customer_support_feedback_tenant_status_created",
        table_name="customer_support_feedback",
    )
    op.drop_table("customer_support_feedback")
