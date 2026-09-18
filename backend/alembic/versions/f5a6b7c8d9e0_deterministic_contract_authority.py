"""make tenant contract authority ordering deterministic

Revision ID: f5a6b7c8d9e0
Revises: e4f5a6b7c8d9
Create Date: 2026-09-18 00:00:00.000000
"""

from alembic import op


revision = "f5a6b7c8d9e0"
down_revision = "e4f5a6b7c8d9"
branch_labels = None
depends_on = None


def _replace_functions(order_by: str) -> None:
    tenant = "NULLIF((SELECT current_setting('app.current_restaurante_id', true)), '')::integer"

    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION koma_internal.current_contract_receipt()
        RETURNS TABLE(
            protocol text,
            accepted_at timestamptz,
            plan text,
            billing_cycle text,
            receipt_snapshot_encrypted text
        )
        LANGUAGE sql
        SECURITY DEFINER
        STABLE
        SET search_path = pg_catalog
        AS $$
            SELECT
                a.protocol::text,
                a.accepted_at,
                a.plan::text,
                a.billing_cycle::text,
                a.receipt_snapshot_encrypted::text
            FROM public.restaurant_contract_acceptances AS link
            JOIN public.contract_acceptances AS a
              ON a.id = link.acceptance_id
            WHERE link.restaurante_id = {tenant}
            ORDER BY {order_by}
            LIMIT 1
        $$
        """
    )
    op.execute(
        "REVOKE ALL ON FUNCTION koma_internal.current_contract_receipt() FROM PUBLIC"
    )
    op.execute(
        "GRANT EXECUTE ON FUNCTION koma_internal.current_contract_receipt() TO koma_app"
    )

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
            ORDER BY {order_by}
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


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    _replace_functions(
        "link.linked_at DESC, a.accepted_at DESC, link.id DESC"
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    _replace_functions("link.linked_at DESC")
