"""Use the signed receipt for price and payer identity."""
from alembic import op
revision = "bd24e5f60718"
down_revision = "ac13d4e5f607"
branch_labels = None
depends_on = None

def upgrade():
    if op.get_bind().dialect.name != 'postgresql': return
    op.execute("""CREATE FUNCTION koma_internal.contract_terms_for_billing(p_protocol text) RETURNS text
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
      SELECT receipt_snapshot_encrypted FROM public.contract_acceptances WHERE protocol=p_protocol LIMIT 1;
      $$""")
    op.execute("REVOKE ALL ON FUNCTION koma_internal.contract_terms_for_billing(text) FROM PUBLIC")
    op.execute("GRANT EXECUTE ON FUNCTION koma_internal.contract_terms_for_billing(text) TO koma_app")

def downgrade():
    if op.get_bind().dialect.name == 'postgresql':
        op.execute("DROP FUNCTION koma_internal.contract_terms_for_billing(text)")
