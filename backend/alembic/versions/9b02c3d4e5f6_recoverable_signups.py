"""Recoverable pre-tenant registrations with encrypted contact data."""
from alembic import op
import sqlalchemy as sa
revision = "9b02c3d4e5f6"
down_revision = "8a91b2c3d4e5"
branch_labels = None
depends_on = None

def upgrade():
    op.create_table("restaurant_signups",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("payload_encrypted", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_restaurant_signup_expiry", "restaurant_signups", ["expires_at"])
    op.create_index("ix_restaurant_signup_created", "restaurant_signups", ["created_at"])
    if op.get_bind().dialect.name != "postgresql": return
    op.execute("REVOKE ALL ON public.restaurant_signups FROM PUBLIC, koma_app")
    functions = {
        "update_signup(text,text)": """
        CREATE FUNCTION koma_internal.update_signup(p_hash text, p_data text) RETURNS void
        LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
          UPDATE public.restaurant_signups s SET payload_encrypted=p_data,updated_at=now()
          WHERE token_hash=p_hash AND expires_at>now() AND NOT EXISTS(SELECT 1 FROM public.contract_acceptances c WHERE c.request_id=s.id);
        $$""",
        "create_signup(text,text,text)": """
        CREATE FUNCTION koma_internal.create_signup(p_id text, p_hash text, p_data text)
        RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
          INSERT INTO public.restaurant_signups VALUES(p_id,p_hash,p_data,now(),now(),now()+interval '30 days');
        $$""",
        "read_signup(text)": """
        CREATE FUNCTION koma_internal.read_signup(p_hash text) RETURNS SETOF public.restaurant_signups
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
          SELECT * FROM public.restaurant_signups WHERE token_hash=p_hash AND expires_at>now();
        $$""",
        "signup_receipt(text)": """
        CREATE FUNCTION koma_internal.signup_receipt(p_id text) RETURNS text
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
          SELECT c.receipt_snapshot_encrypted FROM public.contract_acceptances c
          JOIN public.restaurant_signups s ON s.id=c.request_id WHERE s.id=p_id AND s.expires_at>now();
        $$""",
        "list_signups_for_admin()": """
        CREATE FUNCTION koma_internal.list_signups_for_admin() RETURNS TABLE(
          id text,payload_encrypted text,created_at timestamptz,updated_at timestamptz,
          protocol text,billing_status text,restaurante_id integer)
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
          SELECT s.id::text,s.payload_encrypted,s.created_at,COALESCE(b.updated_at,c.accepted_at,s.updated_at),
          c.protocol::text,b.status::text,l.restaurante_id
          FROM public.restaurant_signups s
          LEFT JOIN public.contract_acceptances c ON c.request_id=s.id
          LEFT JOIN public.saas_billing_setups b ON b.protocol=c.protocol
          LEFT JOIN public.restaurant_contract_acceptances l ON l.acceptance_id=c.id
          WHERE s.expires_at>now() ORDER BY s.created_at DESC LIMIT 200;
        $$"""
    }
    for signature, sql in functions.items():
        op.execute(sql)
        op.execute(f"REVOKE ALL ON FUNCTION koma_internal.{signature} FROM PUBLIC")
        op.execute(f"GRANT EXECUTE ON FUNCTION koma_internal.{signature} TO koma_app")

def downgrade():
    if op.get_bind().dialect.name == "postgresql":
        for signature in ("update_signup(text,text)", "list_signups_for_admin()", "signup_receipt(text)", "read_signup(text)", "create_signup(text,text,text)"):
            op.execute(f"DROP FUNCTION IF EXISTS koma_internal.{signature}")
    op.drop_table("restaurant_signups")
