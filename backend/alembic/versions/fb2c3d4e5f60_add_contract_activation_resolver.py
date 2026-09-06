"""add contract activation resolver

Revision ID: fb2c3d4e5f60
Revises: ea1b2c3d4e5f
Create Date: 2026-09-06 14:20:00.000000
"""

from alembic import op


revision = "fb2c3d4e5f60"
down_revision = "ea1b2c3d4e5f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    op.execute(
        """
        CREATE OR REPLACE FUNCTION koma_internal.resolve_contract_acceptance_for_activation(
            p_protocol text
        ) RETURNS TABLE(
            acceptance_id text,
            protocol text,
            plan text,
            billing_cycle text,
            restaurant_name text,
            contracting_party_name text,
            representative_name text,
            email text,
            phone text,
            linked_restaurante_id integer,
            linked_at timestamptz
        )
        LANGUAGE sql
        SECURITY DEFINER
        STABLE
        SET search_path = pg_catalog
        AS $$
            SELECT
                a.id::text,
                a.protocol::text,
                a.plan::text,
                a.billing_cycle::text,
                a.restaurant_name::text,
                a.contracting_party_name::text,
                a.representative_name::text,
                a.email::text,
                a.phone::text,
                link.restaurante_id,
                link.linked_at
            FROM public.contract_acceptances AS a
            LEFT JOIN public.restaurant_contract_acceptances AS link
              ON link.acceptance_id = a.id
            WHERE a.protocol = upper(btrim(COALESCE(p_protocol, '')))
            LIMIT 1
        $$
        """
    )
    op.execute(
        "REVOKE ALL ON FUNCTION koma_internal.resolve_contract_acceptance_for_activation(text) FROM PUBLIC"
    )
    op.execute(
        "GRANT EXECUTE ON FUNCTION koma_internal.resolve_contract_acceptance_for_activation(text) TO koma_app"
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(
            "DROP FUNCTION IF EXISTS koma_internal.resolve_contract_acceptance_for_activation(text)"
        )
