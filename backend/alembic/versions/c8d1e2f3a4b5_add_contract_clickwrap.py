"""add immutable contract clickwrap evidence

Revision ID: c8d1e2f3a4b5
Revises: b7e5a2c91d44
Create Date: 2026-09-05 20:10:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "c8d1e2f3a4b5"
down_revision = "b7e5a2c91d44"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "contract_acceptances",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("protocol", sa.String(64), nullable=False),
        sa.Column("request_id", sa.String(36), nullable=False),
        sa.Column("contracting_party_name", sa.String(255), nullable=False),
        sa.Column("contracting_party_tax_id_encrypted", sa.Text(), nullable=False),
        sa.Column("contracting_party_tax_id_last4", sa.String(4), nullable=False),
        sa.Column("restaurant_name", sa.String(255), nullable=False),
        sa.Column("representative_name", sa.String(255), nullable=False),
        sa.Column("representative_tax_id_encrypted", sa.Text(), nullable=False),
        sa.Column("representative_tax_id_last4", sa.String(4), nullable=False),
        sa.Column("representative_role", sa.String(100), nullable=False),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("phone", sa.String(50), nullable=False),
        sa.Column("plan", sa.String(20), nullable=False),
        sa.Column("billing_cycle", sa.String(16), nullable=False),
        sa.Column("fixed_monthly_price", sa.Numeric(12, 2), nullable=False),
        sa.Column("billing_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("annual_monthly_equivalent", sa.Numeric(12, 2), nullable=True),
        sa.Column("marketplace_rate", sa.Numeric(8, 6), nullable=False),
        sa.Column("legal_version", sa.String(16), nullable=False),
        sa.Column("terms_hash", sa.String(64), nullable=False),
        sa.Column("commercial_hash", sa.String(64), nullable=False),
        sa.Column("dpa_hash", sa.String(64), nullable=False),
        sa.Column("privacy_hash", sa.String(64), nullable=False),
        sa.Column("terms_snapshot", sa.Text(), nullable=False),
        sa.Column("commercial_snapshot", sa.Text(), nullable=False),
        sa.Column("dpa_snapshot", sa.Text(), nullable=False),
        sa.Column("privacy_snapshot", sa.Text(), nullable=False),
        sa.Column("legal_source_commit", sa.String(40), nullable=False),
        sa.Column("legal_source_blob_sha", sa.String(40), nullable=False),
        sa.Column("powers_declared", sa.Boolean(), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("source_ip_encrypted", sa.Text(), nullable=False),
        sa.Column("source_ip_hash", sa.String(64), nullable=False),
        sa.Column("user_agent", sa.Text(), nullable=False),
        sa.Column("user_agent_hash", sa.String(64), nullable=False),
        sa.Column("receipt_snapshot_encrypted", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("protocol", name="uq_contract_acceptances_protocol"),
        sa.UniqueConstraint("request_id", name="uq_contract_acceptances_request_id"),
    )
    op.create_index(
        "ix_contract_acceptances_protocol", "contract_acceptances", ["protocol"]
    )
    op.create_index(
        "ix_contract_acceptances_request_id", "contract_acceptances", ["request_id"]
    )
    op.create_index(
        "ix_contract_acceptances_accepted_at", "contract_acceptances", ["accepted_at"]
    )
    op.create_index(
        "ix_contract_acceptances_email_accepted",
        "contract_acceptances",
        ["email", "accepted_at"],
    )

    op.create_table(
        "restaurant_contract_acceptances",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("restaurante_id", sa.Integer(), nullable=False),
        sa.Column("acceptance_id", sa.String(36), nullable=False),
        sa.Column("linked_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["restaurante_id"], ["restaurantes.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["acceptance_id"], ["contract_acceptances.id"], ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "acceptance_id", name="uq_restaurant_contract_acceptances_acceptance_id"
        ),
        sa.UniqueConstraint(
            "restaurante_id",
            "acceptance_id",
            name="uq_restaurant_contract_acceptance_link",
        ),
    )
    op.create_index(
        "ix_restaurant_contract_acceptances_restaurante_id",
        "restaurant_contract_acceptances",
        ["restaurante_id"],
    )
    op.create_index(
        "ix_restaurant_contract_acceptances_acceptance_id",
        "restaurant_contract_acceptances",
        ["acceptance_id"],
    )
    op.create_index(
        "ix_restaurant_contract_acceptances_tenant_linked",
        "restaurant_contract_acceptances",
        ["restaurante_id", "linked_at"],
    )

    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    tenant = "NULLIF((SELECT current_setting('app.current_restaurante_id', true)), '')::integer"

    # Evidência global: o runtime só pode inserir. Não há SELECT/UPDATE/DELETE
    # direto em contract_acceptances; leitura ocorre por funções SECURITY DEFINER
    # que filtram por protocolo ou tenant.
    op.execute("REVOKE ALL ON TABLE public.contract_acceptances FROM PUBLIC")
    op.execute("REVOKE ALL ON TABLE public.contract_acceptances FROM koma_app")
    op.execute("GRANT INSERT ON TABLE public.contract_acceptances TO koma_app")

    # O vínculo é tenant-scoped e entra no mesmo padrão auditado do restante do SaaS.
    op.execute(
        "ALTER TABLE public.restaurant_contract_acceptances ENABLE ROW LEVEL SECURITY"
    )
    op.execute(
        "ALTER TABLE public.restaurant_contract_acceptances FORCE ROW LEVEL SECURITY"
    )
    op.execute(
        "CREATE POLICY tenant_isolation ON public.restaurant_contract_acceptances "
        "FOR ALL TO koma_app "
        f"USING (restaurante_id = {tenant}) "
        f"WITH CHECK (restaurante_id = {tenant})"
    )
    op.execute("REVOKE ALL ON TABLE public.restaurant_contract_acceptances FROM PUBLIC")
    op.execute("REVOKE ALL ON TABLE public.restaurant_contract_acceptances FROM koma_app")
    op.execute(
        "GRANT SELECT, INSERT ON TABLE public.restaurant_contract_acceptances TO koma_app"
    )

    op.execute(
        """
        CREATE OR REPLACE FUNCTION koma_internal.resolve_contract_acceptance_for_link(
            p_protocol text
        ) RETURNS TABLE(
            acceptance_id text,
            protocol text,
            plan text,
            billing_cycle text,
            restaurant_name text,
            contracting_party_name text,
            email text
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
                a.email::text
            FROM public.contract_acceptances AS a
            WHERE a.protocol = upper(btrim(COALESCE(p_protocol, '')))
            LIMIT 1
        $$
        """
    )
    op.execute(
        "REVOKE ALL ON FUNCTION koma_internal.resolve_contract_acceptance_for_link(text) FROM PUBLIC"
    )
    op.execute(
        "GRANT EXECUTE ON FUNCTION koma_internal.resolve_contract_acceptance_for_link(text) TO koma_app"
    )

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
            ORDER BY link.linked_at DESC
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


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(
            "DROP FUNCTION IF EXISTS koma_internal.current_contract_receipt()"
        )
        op.execute(
            "DROP FUNCTION IF EXISTS koma_internal.resolve_contract_acceptance_for_link(text)"
        )

    op.drop_index(
        "ix_restaurant_contract_acceptances_tenant_linked",
        table_name="restaurant_contract_acceptances",
    )
    op.drop_index(
        "ix_restaurant_contract_acceptances_acceptance_id",
        table_name="restaurant_contract_acceptances",
    )
    op.drop_index(
        "ix_restaurant_contract_acceptances_restaurante_id",
        table_name="restaurant_contract_acceptances",
    )
    op.drop_table("restaurant_contract_acceptances")

    op.drop_index(
        "ix_contract_acceptances_email_accepted",
        table_name="contract_acceptances",
    )
    op.drop_index(
        "ix_contract_acceptances_accepted_at",
        table_name="contract_acceptances",
    )
    op.drop_index(
        "ix_contract_acceptances_request_id",
        table_name="contract_acceptances",
    )
    op.drop_index(
        "ix_contract_acceptances_protocol",
        table_name="contract_acceptances",
    )
    op.drop_table("contract_acceptances")
