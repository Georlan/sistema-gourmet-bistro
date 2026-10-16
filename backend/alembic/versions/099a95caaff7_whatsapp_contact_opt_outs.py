"""whatsapp_contact_opt_outs

Revision ID: 099a95caaff7
Revises: c8a2d4e6f901
Create Date: 2026-10-16 14:40:53.746774

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '099a95caaff7'
down_revision: Union[str, Sequence[str], None] = 'c8a2d4e6f901'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('configuracoes_restaurante', sa.Column('whatsapp_budget_month', sa.String(7), nullable=True))
    op.add_column('configuracoes_restaurante', sa.Column('whatsapp_budget_attempts', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('configuracoes_restaurante', sa.Column('whatsapp_budget_cost', sa.Numeric(14, 4), nullable=False, server_default='0'))
    op.create_table('whatsapp_contact_opt_outs',
        sa.Column('restaurante_id', sa.Integer(), sa.ForeignKey('restaurantes.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('phone_hash', sa.String(64), primary_key=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_table('central_whatsapp_sender_state',
        sa.Column('sender_key', sa.String(64), primary_key=True),
        sa.Column('next_send_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('circuit_open_until', sa.DateTime(timezone=True), nullable=True),
        sa.Column('failures', sa.Integer(), nullable=False, server_default='0'),
    )
    if op.get_bind().dialect.name == 'postgresql':
        op.execute('ALTER TABLE public.central_whatsapp_sender_state ENABLE ROW LEVEL SECURITY')
        op.execute('ALTER TABLE public.central_whatsapp_sender_state FORCE ROW LEVEL SECURITY')
        op.execute('REVOKE ALL ON TABLE public.central_whatsapp_sender_state FROM PUBLIC')
        op.execute("""DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'koma_app') THEN
            GRANT SELECT, INSERT, UPDATE ON TABLE public.central_whatsapp_sender_state TO koma_app;
        END IF; END $$;""")
        op.execute('CREATE POLICY sender_worker ON public.central_whatsapp_sender_state TO koma_app USING (true) WITH CHECK (true)')
        op.execute('ALTER TABLE public.whatsapp_contact_opt_outs ENABLE ROW LEVEL SECURITY')
        op.execute('ALTER TABLE public.whatsapp_contact_opt_outs FORCE ROW LEVEL SECURITY')
        op.execute('REVOKE ALL ON TABLE public.whatsapp_contact_opt_outs FROM PUBLIC')
        op.execute("""DO $$ DECLARE role_name text; BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'koma_app') THEN
                GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.whatsapp_contact_opt_outs TO koma_app;
            END IF;
            FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
                EXECUTE format('REVOKE ALL ON TABLE public.whatsapp_contact_opt_outs FROM %I', role_name);
                EXECUTE format('REVOKE ALL ON TABLE public.central_whatsapp_sender_state FROM %I', role_name);
            END LOOP;
        END $$;""")
        op.execute("""CREATE POLICY tenant_isolation ON public.whatsapp_contact_opt_outs
            USING (restaurante_id = NULLIF(current_setting('app.current_restaurante_id', true), '')::integer)
            WITH CHECK (restaurante_id = NULLIF(current_setting('app.current_restaurante_id', true), '')::integer)""")


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('central_whatsapp_sender_state')
    op.drop_table('whatsapp_contact_opt_outs')
    for column in ('whatsapp_budget_cost', 'whatsapp_budget_attempts', 'whatsapp_budget_month'):
        op.drop_column('configuracoes_restaurante', column)
