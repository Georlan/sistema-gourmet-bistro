"""add superadmin contract inbox read model

Revision ID: ea1b2c3d4e5f
Revises: d9e0f1a2b3c4
Create Date: 2026-09-06 12:50:00.000000
"""

from alembic import op


revision = "ea1b2c3d4e5f"
down_revision = "d9e0f1a2b3c4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    # Read model global somente para o control plane. O runtime continua sem
    # SELECT direto em contract_acceptances; a leitura passa por uma função
    # SECURITY DEFINER com conjunto de campos explicitamente limitado.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION koma_internal.list_contract_acceptances_for_admin(
            p_limit integer DEFAULT 100
        ) RETURNS TABLE(
            acceptance_id text,
            protocol text,
            accepted_at timestamptz,
            restaurant_name text,
            contracting_party_name text,
            contracting_party_tax_id_last4 text,
            representative_name text,
            representative_tax_id_last4 text,
            representative_role text,
            email text,
            phone text,
            plan text,
            billing_cycle text,
            fixed_monthly_price numeric,
            billing_amount numeric,
            annual_monthly_equivalent numeric,
            marketplace_rate numeric,
            legal_version text,
            terms_hash text,
            commercial_hash text,
            dpa_hash text,
            privacy_hash text,
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
                a.accepted_at,
                a.restaurant_name::text,
                a.contracting_party_name::text,
                a.contracting_party_tax_id_last4::text,
                a.representative_name::text,
                a.representative_tax_id_last4::text,
                a.representative_role::text,
                a.email::text,
                a.phone::text,
                a.plan::text,
                a.billing_cycle::text,
                a.fixed_monthly_price,
                a.billing_amount,
                a.annual_monthly_equivalent,
                a.marketplace_rate,
                a.legal_version::text,
                a.terms_hash::text,
                a.commercial_hash::text,
                a.dpa_hash::text,
                a.privacy_hash::text,
                link.restaurante_id,
                link.linked_at
            FROM public.contract_acceptances AS a
            LEFT JOIN public.restaurant_contract_acceptances AS link
              ON link.acceptance_id = a.id
            ORDER BY a.accepted_at DESC
            LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200)
        $$
        """
    )
    op.execute(
        "REVOKE ALL ON FUNCTION koma_internal.list_contract_acceptances_for_admin(integer) FROM PUBLIC"
    )
    op.execute(
        "GRANT EXECUTE ON FUNCTION koma_internal.list_contract_acceptances_for_admin(integer) TO koma_app"
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(
            "DROP FUNCTION IF EXISTS koma_internal.list_contract_acceptances_for_admin(integer)"
        )
