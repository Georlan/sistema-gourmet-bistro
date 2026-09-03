"""add restaurant trials

Revision ID: 3d4e5f6a7b8c
Revises: 2b3c4d5e6f7a
Create Date: 2026-09-03 10:22:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "3d4e5f6a7b8c"
down_revision = "2b3c4d5e6f7a"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()

    op.create_table(
        "restaurant_trials",
        sa.Column("restaurante_id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("trial_started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("trial_ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("trial_status", sa.String(length=20), nullable=False),
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
            name="fk_restaurant_trials_restaurante_id",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "trial_status IN ('active', 'ended', 'converted')",
            name="ck_restaurant_trials_status",
        ),
    )
    op.create_index(
        "ix_restaurant_trials_trial_ends_at",
        "restaurant_trials",
        ["trial_ends_at"],
        unique=False,
    )

    if bind.dialect.name != "postgresql":
        return

    tenant_expr = (
        "restaurante_id = NULLIF("
        "current_setting('app.current_restaurante_id', true), ''"
        ")::integer"
    )

    op.execute("ALTER TABLE public.restaurant_trials ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.restaurant_trials FORCE ROW LEVEL SECURITY")

    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'koma_app') THEN
                REVOKE ALL ON TABLE public.restaurant_trials FROM koma_app;
                GRANT SELECT, INSERT, UPDATE ON TABLE public.restaurant_trials TO koma_app;
            END IF;
        END
        $$;
    """)

    op.execute(f"""
        CREATE POLICY restaurant_trials_select
        ON public.restaurant_trials
        FOR SELECT
        TO koma_app
        USING ({tenant_expr})
    """)
    op.execute(f"""
        CREATE POLICY restaurant_trials_insert
        ON public.restaurant_trials
        FOR INSERT
        TO koma_app
        WITH CHECK ({tenant_expr})
    """)
    op.execute(f"""
        CREATE POLICY restaurant_trials_update
        ON public.restaurant_trials
        FOR UPDATE
        TO koma_app
        USING ({tenant_expr})
        WITH CHECK ({tenant_expr})
    """)


def downgrade() -> None:
    bind = op.get_bind()

    if bind.dialect.name == "postgresql":
        op.execute(
            "DROP POLICY IF EXISTS restaurant_trials_update ON public.restaurant_trials"
        )
        op.execute(
            "DROP POLICY IF EXISTS restaurant_trials_insert ON public.restaurant_trials"
        )
        op.execute(
            "DROP POLICY IF EXISTS restaurant_trials_select ON public.restaurant_trials"
        )

    op.drop_index(
        "ix_restaurant_trials_trial_ends_at",
        table_name="restaurant_trials",
    )
    op.drop_table("restaurant_trials")
