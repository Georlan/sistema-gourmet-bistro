"""resolve Mercado Pago webhook seller account under RLS

Revision ID: 1c2d3e4f5a6b
Revises: 0a1b2c3d4e5f
Create Date: 2026-09-02 01:15:00.000000
"""

from alembic import op


revision = "1c2d3e4f5a6b"
down_revision = "0a1b2c3d4e5f"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    op.execute(
        """
        CREATE OR REPLACE FUNCTION koma_internal.resolve_mercado_pago_account_id(
            p_provider_user_id text
        )
        RETURNS text
        LANGUAGE sql
        SECURITY DEFINER
        STABLE
        SET search_path = pg_catalog
        AS $$
            SELECT a.id::text
            FROM public.restaurant_payment_accounts AS a
            WHERE pg_has_role(session_user, 'koma_app', 'member')
              AND a.provider = 'mercado_pago'
              AND a.provider_user_id = btrim(COALESCE(p_provider_user_id, ''))
              AND a.status = 'active'
            LIMIT 1
        $$
        """
    )
    op.execute(
        "REVOKE ALL ON FUNCTION "
        "koma_internal.resolve_mercado_pago_account_id(text) FROM PUBLIC"
    )
    op.execute(
        "GRANT EXECUTE ON FUNCTION "
        "koma_internal.resolve_mercado_pago_account_id(text) TO koma_app"
    )


def downgrade():
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    op.execute(
        "DROP FUNCTION IF EXISTS "
        "koma_internal.resolve_mercado_pago_account_id(text)"
    )
