"""Opaque WhatsApp capabilities, FORCE RLS and narrow tenant discovery."""
from alembic import op
import sqlalchemy as sa

revision = 'c2f3a4b5d6e7'
down_revision = 'b1e2f3a4b5c6'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('whatsapp_opt_out_capabilities',
        sa.Column('token_hash', sa.String(64), primary_key=True),
        sa.Column('restaurante_id', sa.Integer(), sa.ForeignKey('restaurantes.id', ondelete='CASCADE'), nullable=False),
        sa.Column('phone_hash', sa.String(64), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index('ix_wa_optout_capability_tenant', 'whatsapp_opt_out_capabilities', ['restaurante_id'])
    if op.get_bind().dialect.name != 'postgresql':
        return
    op.execute('ALTER TABLE public.whatsapp_opt_out_capabilities ENABLE ROW LEVEL SECURITY')
    op.execute('ALTER TABLE public.whatsapp_opt_out_capabilities FORCE ROW LEVEL SECURITY')
    op.execute('REVOKE ALL ON public.whatsapp_opt_out_capabilities FROM PUBLIC')
    op.execute('GRANT SELECT, INSERT ON public.whatsapp_opt_out_capabilities TO koma_app')
    op.execute("""CREATE POLICY tenant_isolation ON public.whatsapp_opt_out_capabilities
        USING (restaurante_id = NULLIF((SELECT current_setting('app.current_restaurante_id', true)), '')::integer)
        WITH CHECK (restaurante_id = NULLIF((SELECT current_setting('app.current_restaurante_id', true)), '')::integer)""")
    op.execute("""
        CREATE FUNCTION koma_internal.lookup_whatsapp_opt_out(digest text)
        RETURNS TABLE(restaurante_id integer)
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
        AS $fn$
            SELECT c.restaurante_id FROM public.whatsapp_opt_out_capabilities c
            WHERE c.token_hash = digest AND c.expires_at > CURRENT_TIMESTAMP
                AND length(digest) = 64
        $fn$;
        REVOKE ALL ON FUNCTION koma_internal.lookup_whatsapp_opt_out(text) FROM PUBLIC;
        GRANT EXECUTE ON FUNCTION koma_internal.lookup_whatsapp_opt_out(text) TO koma_app;
    """)
    for role in ('anon', 'authenticated'):
        if op.get_bind().execute(sa.text('SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=:role)'), {'role': role}).scalar():
            op.execute(f'REVOKE ALL ON public.whatsapp_opt_out_capabilities FROM {role}')
            op.execute(f'REVOKE ALL ON FUNCTION koma_internal.lookup_whatsapp_opt_out(text) FROM {role}')


def downgrade():
    if op.get_bind().dialect.name == 'postgresql':
        op.execute('DROP FUNCTION koma_internal.lookup_whatsapp_opt_out(text)')
    op.drop_table('whatsapp_opt_out_capabilities')
