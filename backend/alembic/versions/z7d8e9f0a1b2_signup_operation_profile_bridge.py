"""Expose only the encrypted signup payload linked to a contract protocol."""
from alembic import op

revision = "z7d8e9f0a1b2"
down_revision = "z6c7d8e9f0a1"
branch_labels = None
depends_on = None


def upgrade():
    if op.get_bind().dialect.name != "postgresql":
        return

    op.execute(
        """
        CREATE OR REPLACE FUNCTION koma_internal.signup_payload_for_contract(
            p_protocol text
        ) RETURNS text
        LANGUAGE sql
        SECURITY DEFINER
        STABLE
        SET search_path = pg_catalog
        AS $$
            SELECT s.payload_encrypted
            FROM public.contract_acceptances AS c
            JOIN public.restaurant_signups AS s
              ON s.id = c.request_id
            WHERE c.protocol = upper(btrim(COALESCE(p_protocol, '')))
            LIMIT 1
        $$;
        """
    )
    op.execute(
        "REVOKE ALL ON FUNCTION koma_internal.signup_payload_for_contract(text) FROM PUBLIC"
    )
    op.execute(
        "GRANT EXECUTE ON FUNCTION koma_internal.signup_payload_for_contract(text) TO koma_app"
    )


def downgrade():
    if op.get_bind().dialect.name == "postgresql":
        op.execute(
            "DROP FUNCTION IF EXISTS koma_internal.signup_payload_for_contract(text)"
        )
