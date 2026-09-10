"""add restaurant operation profiles

Revision ID: 7f8091a2b3c4
Revises: 6e7f8091a2b3
Create Date: 2026-09-10 05:45:00.000000
"""

from alembic import op
import sqlalchemy as sa

revision = "7f8091a2b3c4"
down_revision = "6e7f8091a2b3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "restaurante_operation_profiles",
        sa.Column("restaurante_id", sa.Integer(), nullable=False),
        sa.Column(
            "profile_key",
            sa.String(length=64),
            server_default="generic",
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["restaurante_id"],
            ["restaurantes.id"],
            name="fk_restaurante_operation_profiles_restaurante_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "restaurante_id",
            name="pk_restaurante_operation_profiles",
        ),
        sa.CheckConstraint(
            "length(trim(profile_key)) > 0",
            name="ck_restaurante_operation_profiles_profile_key_nonblank",
        ),
    )

    tenant_expr = (
        "restaurante_id = NULLIF("
        "current_setting('app.current_restaurante_id', true), ''"
        ")::integer"
    )
    op.execute(
        "ALTER TABLE public.restaurante_operation_profiles "
        "ENABLE ROW LEVEL SECURITY"
    )
    op.execute(
        "ALTER TABLE public.restaurante_operation_profiles "
        "FORCE ROW LEVEL SECURITY"
    )
    op.execute(
        f"""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'koma_app') THEN
                REVOKE ALL ON TABLE public.restaurante_operation_profiles FROM PUBLIC;
                REVOKE ALL ON TABLE public.restaurante_operation_profiles FROM koma_app;
                GRANT SELECT, INSERT, UPDATE, DELETE
                    ON TABLE public.restaurante_operation_profiles TO koma_app;

                CREATE POLICY restaurante_operation_profiles_select
                    ON public.restaurante_operation_profiles
                    FOR SELECT TO koma_app USING ({tenant_expr});
                CREATE POLICY restaurante_operation_profiles_insert
                    ON public.restaurante_operation_profiles
                    FOR INSERT TO koma_app WITH CHECK ({tenant_expr});
                CREATE POLICY restaurante_operation_profiles_update
                    ON public.restaurante_operation_profiles
                    FOR UPDATE TO koma_app USING ({tenant_expr}) WITH CHECK ({tenant_expr});
                CREATE POLICY restaurante_operation_profiles_delete
                    ON public.restaurante_operation_profiles
                    FOR DELETE TO koma_app USING ({tenant_expr});
            END IF;
        END
        $$;
        """
    )


def downgrade() -> None:
    op.drop_table("restaurante_operation_profiles")
