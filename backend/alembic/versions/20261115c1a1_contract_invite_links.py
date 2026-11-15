"""Add single-use contract acceptance invites table with tenant RLS."""
from alembic import op
import sqlalchemy as sa

revision = "20261115c1a1"
down_revision = "c6a1d2e3f4b5"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    op.create_table(
        "contract_invites",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("restaurante_id", sa.Integer(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("plan", sa.String(length=20), nullable=False),
        sa.Column("billing_cycle", sa.String(length=16), nullable=False),
        sa.Column("created_by", sa.String(length=120), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("acceptance_id", sa.String(length=36), nullable=True),
        sa.Column("protocol", sa.String(length=64), nullable=True),
        sa.ForeignKeyConstraint(["restaurante_id"], ["restaurantes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index("ix_contract_invites_restaurante_id", "contract_invites", ["restaurante_id"], unique=False)
    op.create_index("ix_contract_invites_token_hash", "contract_invites", ["token_hash"], unique=True)
    op.create_index("ix_contract_invites_tenant_created", "contract_invites", ["restaurante_id", "created_at"], unique=False)

    if bind.dialect.name != "postgresql":
        return

    tenant_expr = (
        "restaurante_id = NULLIF("
        "current_setting('app.current_restaurante_id', true), ''"
        ")::integer"
    )
    op.execute("ALTER TABLE public.contract_invites ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.contract_invites FORCE ROW LEVEL SECURITY")
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'koma_app') THEN
                REVOKE ALL ON TABLE public.contract_invites FROM PUBLIC;
                GRANT SELECT, INSERT, UPDATE ON TABLE public.contract_invites TO koma_app;
            END IF;
        END
        $$;
    """)
    op.execute(f"""
        CREATE POLICY contract_invites_select
        ON public.contract_invites
        FOR SELECT
        TO koma_app
        USING ({tenant_expr})
    """)
    op.execute(f"""
        CREATE POLICY contract_invites_insert
        ON public.contract_invites
        FOR INSERT
        TO koma_app
        WITH CHECK ({tenant_expr})
    """)
    op.execute(f"""
        CREATE POLICY contract_invites_update
        ON public.contract_invites
        FOR UPDATE
        TO koma_app
        USING ({tenant_expr})
        WITH CHECK ({tenant_expr})
    """)


def downgrade():
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("DROP POLICY IF EXISTS contract_invites_update ON public.contract_invites")
        op.execute("DROP POLICY IF EXISTS contract_invites_insert ON public.contract_invites")
        op.execute("DROP POLICY IF EXISTS contract_invites_select ON public.contract_invites")
    op.drop_index("ix_contract_invites_tenant_created", table_name="contract_invites")
    op.drop_index("ix_contract_invites_token_hash", table_name="contract_invites")
    op.drop_index("ix_contract_invites_restaurante_id", table_name="contract_invites")
    op.drop_table("contract_invites")
