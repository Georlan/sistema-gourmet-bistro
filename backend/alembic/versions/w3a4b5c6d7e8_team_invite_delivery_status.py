"""Expose only the current tenant's team email delivery metadata."""
from alembic import op

revision = 'w3a4b5c6d7e8'
down_revision = 'v2f3a4b5c6d7'
branch_labels = None
depends_on = None


def upgrade():
    if op.get_bind().dialect.name != 'postgresql':
        return
    op.execute("""
        CREATE FUNCTION koma_internal.team_invite_delivery_status()
        RETURNS TABLE(id text, status text, last_error text)
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
        SELECT n.id::text, n.status::text, n.last_error::text
        FROM public.signup_notifications n
        WHERE starts_with(n.id, 'team-' || nullif(current_setting('app.current_restaurante_id', true), '') || '-');
        $$
    """)
    op.execute('REVOKE ALL ON FUNCTION koma_internal.team_invite_delivery_status() FROM PUBLIC')
    op.execute('GRANT EXECUTE ON FUNCTION koma_internal.team_invite_delivery_status() TO koma_app')


def downgrade():
    if op.get_bind().dialect.name == 'postgresql':
        op.execute('DROP FUNCTION IF EXISTS koma_internal.team_invite_delivery_status()')
