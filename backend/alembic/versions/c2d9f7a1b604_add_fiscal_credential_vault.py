"""add encrypted fiscal credential vault

Revision ID: c2d9f7a1b604
Revises: ab41d7c9e205
Create Date: 2026-09-15
"""

from alembic import op
import sqlalchemy as sa


revision = "c2d9f7a1b604"
down_revision = "ab41d7c9e205"
branch_labels = None
depends_on = None


TABLE = "fiscal_credential_secrets"


def upgrade() -> None:
    op.create_table(
        TABLE,
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("restaurante_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("ciphertext", sa.Text(), nullable=False),
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
        sa.CheckConstraint(
            "kind IN ('certificate_a1','csc')",
            name="ck_fiscal_credential_secret_kind",
        ),
        sa.ForeignKeyConstraint(
            ["restaurante_id"],
            ["restaurantes.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "restaurante_id",
            "kind",
            name="uq_fiscal_credential_secret_tenant_kind",
        ),
    )
    op.create_index(
        "ix_fiscal_credential_secret_tenant_kind",
        TABLE,
        ["restaurante_id", "kind"],
        unique=False,
    )

    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    tenant_expression = """
        NULLIF(
            current_setting('app.current_restaurante_id', true),
            ''
        )::integer
    """
    op.execute(f"ALTER TABLE public.{TABLE} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE public.{TABLE} FORCE ROW LEVEL SECURITY")
    op.execute(
        f"""
        CREATE POLICY tenant_isolation ON public.{TABLE}
        AS PERMISSIVE
        FOR ALL
        TO koma_app
        USING (restaurante_id = {tenant_expression})
        WITH CHECK (restaurante_id = {tenant_expression})
        """
    )
    op.execute(
        f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.{TABLE} TO koma_app"
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON public.{TABLE}")
        op.execute(
            f"REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE public.{TABLE} FROM koma_app"
        )
    op.drop_index("ix_fiscal_credential_secret_tenant_kind", table_name=TABLE)
    op.drop_table(TABLE)
