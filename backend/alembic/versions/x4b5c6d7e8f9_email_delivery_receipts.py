"""Minimal verified delivery receipts; narrow capabilities, no recipient data."""
from alembic import op
import sqlalchemy as sa

revision = 'x4b5c6d7e8f9'
down_revision = 'w3a4b5c6d7e8'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('email_delivery_receipts',
        sa.Column('email_id', sa.String(36), primary_key=True),
        sa.Column('notification_id', sa.String(100), unique=True),
        sa.Column('status', sa.String(32), nullable=False),
        sa.Column('occurred_at', sa.DateTime(timezone=True), nullable=False))
    if op.get_bind().dialect.name != 'postgresql':
        return
    op.execute('REVOKE ALL ON public.email_delivery_receipts FROM PUBLIC, koma_app')
    op.execute("""
    CREATE FUNCTION koma_internal.record_email_acceptance(p_email_id text,p_notification_id text)
    RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
    INSERT INTO public.email_delivery_receipts(email_id,notification_id,status,occurred_at)
    VALUES (p_email_id::uuid::text,p_notification_id,'sent','1970-01-01T00:00:00Z')
    ON CONFLICT(email_id) DO UPDATE SET notification_id=EXCLUDED.notification_id;
    $$;
    CREATE FUNCTION koma_internal.record_email_delivery_event(p_email_id text,p_state text,p_time timestamptz)
    RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
    INSERT INTO public.email_delivery_receipts(email_id,status,occurred_at)
    SELECT p_email_id::uuid::text,p_state,p_time
    WHERE p_state IN ('sent','delivered','delivery_delayed','bounced','complained','failed','suppressed')
    ON CONFLICT(email_id) DO UPDATE SET status=EXCLUDED.status,occurred_at=EXCLUDED.occurred_at
    WHERE EXCLUDED.occurred_at>=email_delivery_receipts.occurred_at
      AND (email_delivery_receipts.status NOT IN ('delivered','bounced','complained','failed','suppressed')
           OR EXCLUDED.status IN ('delivered','bounced','complained','failed','suppressed'));
    $$;
    """)
    for signature in ('record_email_acceptance(text,text)', 'record_email_delivery_event(text,text,timestamptz)'):
        op.execute(f'REVOKE ALL ON FUNCTION koma_internal.{signature} FROM PUBLIC')
        op.execute(f'GRANT EXECUTE ON FUNCTION koma_internal.{signature} TO koma_app')
    op.execute('DROP FUNCTION koma_internal.team_invite_delivery_status()')
    op.execute("""
    CREATE FUNCTION koma_internal.team_invite_delivery_status()
    RETURNS TABLE(id text,status text,last_error text,delivery_status text)
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
    SELECT n.id::text,n.status::text,n.last_error::text,r.status::text
    FROM public.signup_notifications n
    LEFT JOIN public.email_delivery_receipts r ON r.notification_id=n.id
    WHERE starts_with(n.id,'team-'||nullif(current_setting('app.current_restaurante_id',true),'')||'-');
    $$;
    REVOKE ALL ON FUNCTION koma_internal.team_invite_delivery_status() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION koma_internal.team_invite_delivery_status() TO koma_app;
    """)


def downgrade():
    if op.get_bind().dialect.name == 'postgresql':
        op.execute('DROP FUNCTION koma_internal.team_invite_delivery_status()')
        op.execute("""
        CREATE FUNCTION koma_internal.team_invite_delivery_status()
        RETURNS TABLE(id text,status text,last_error text)
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
        SELECT n.id::text,n.status::text,n.last_error::text FROM public.signup_notifications n
        WHERE starts_with(n.id,'team-'||nullif(current_setting('app.current_restaurante_id',true),'')||'-');
        $$;
        REVOKE ALL ON FUNCTION koma_internal.team_invite_delivery_status() FROM PUBLIC;
        GRANT EXECUTE ON FUNCTION koma_internal.team_invite_delivery_status() TO koma_app;
        """)
        for signature in ('record_email_acceptance(text,text)', 'record_email_delivery_event(text,text,timestamptz)'):
            op.execute(f'DROP FUNCTION koma_internal.{signature}')
    op.drop_table('email_delivery_receipts')
