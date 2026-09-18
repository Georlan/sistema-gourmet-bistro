"""expose tenant-scoped immutable contract snapshots

Revision ID: e4f5a6b7c8d9
Revises: d3e4f5a6b7c8
Create Date: 2026-09-18 00:00:00.000000
"""

from alembic import op


revision = "e4f5a6b7c8d9"
down_revision = "d3e4f5a6b7c8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    tenant = "NULLIF((SELECT current_setting('app.current_restaurante_id', true)), '')::integer"

    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION koma_internal.current_contract_documents()
        RETURNS TABLE(
            protocol text,
            legal_version text,
            terms_snapshot text,
            commercial_snapshot text,
            dpa_snapshot text,
            privacy_snapshot text
        )
        LANGUAGE sql
        SECURITY DEFINER
        STABLE
        SET search_path = pg_catalog
        AS $$
            SELECT
                a.protocol::text,
                a.legal_version::text,
                a.terms_snapshot::text,
                a.commercial_snapshot::text,
                a.dpa_snapshot::text,
                a.privacy_snapshot::text
            FROM public.restaurant_contract_acceptances AS link
            JOIN public.contract_acceptances AS a
              ON a.id = link.acceptance_id
            WHERE link.restaurante_id = {tenant}
            ORDER BY link.linked_at DESC
            LIMIT 1
        $$
        """
    )
    op.execute(
        "REVOKE ALL ON FUNCTION koma_internal.current_contract_documents() FROM PUBLIC"
    )
    op.execute(
        "GRANT EXECUTE ON FUNCTION koma_internal.current_contract_documents() TO koma_app"
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    op.execute(
        "DROP FUNCTION IF EXISTS koma_internal.current_contract_documents()"
    )
