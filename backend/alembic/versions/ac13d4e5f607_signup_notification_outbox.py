"""Durable signup delivery queue with narrow worker capabilities."""
from alembic import op
import sqlalchemy as sa
revision = "ac13d4e5f607"
down_revision = "9b02c3d4e5f6"
branch_labels = None
depends_on = None

def upgrade():
    op.create_table("signup_notifications",
      sa.Column("id", sa.String(100), primary_key=True), sa.Column("payload_encrypted", sa.Text(), nullable=False),
      sa.Column("status", sa.String(20), nullable=False), sa.Column("attempts", sa.Integer(), nullable=False),
      sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False), sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
      sa.Column("claim_token", sa.String(36)), sa.Column("last_error", sa.String(100)))
    op.create_index("ix_signup_notification_due", "signup_notifications", ["status", "next_attempt_at"])
    if op.get_bind().dialect.name != "postgresql": return
    op.execute("REVOKE ALL ON public.signup_notifications FROM PUBLIC, koma_app")
    op.execute("GRANT INSERT ON public.signup_notifications TO koma_app")
    functions = {
      "retry_signup_notification(text)": """
      CREATE FUNCTION koma_internal.retry_signup_notification(p_id text) RETURNS boolean
      LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
      WITH changed AS (UPDATE public.signup_notifications SET status='pending',attempts=0,next_attempt_at=now(),last_error=NULL
        WHERE id=p_id AND status IN ('pending','failed') AND expires_at>now() AND payload_encrypted<>'' RETURNING id)
      SELECT EXISTS(SELECT 1 FROM changed);
      $$""",
      "claim_signup_notifications(text)": """
      CREATE FUNCTION koma_internal.claim_signup_notifications(p_claim text) RETURNS SETOF public.signup_notifications
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
        DELETE FROM public.restaurant_signups WHERE expires_at<now();
        UPDATE public.signup_notifications SET status='failed',last_error='expired',payload_encrypted=''
          WHERE expires_at<now() AND status IN ('pending','sending');
        RETURN QUERY WITH candidates AS (SELECT id FROM public.signup_notifications
          WHERE status IN ('pending','sending') AND next_attempt_at<=now() AND expires_at>now()
          ORDER BY next_attempt_at LIMIT 10 FOR UPDATE SKIP LOCKED)
        UPDATE public.signup_notifications n SET status='sending',claim_token=p_claim,attempts=attempts+1,next_attempt_at=now()+interval '5 minutes'
          FROM candidates c WHERE n.id=c.id RETURNING n.*;
      END $$""",
      "settle_signup_notification(text,text,text,text,timestamptz)": """
      CREATE FUNCTION koma_internal.settle_signup_notification(p_id text,p_claim text,p_status text,p_error text,p_due timestamptz)
      RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
      UPDATE public.signup_notifications SET status=p_status,last_error=p_error,next_attempt_at=p_due,claim_token=NULL,
        payload_encrypted=CASE WHEN p_status='sent' THEN '' ELSE payload_encrypted END
        WHERE id=p_id AND claim_token=p_claim AND p_status IN ('sent','pending','failed');
      $$""",
      "signup_delivery_status()": """
      CREATE FUNCTION koma_internal.signup_delivery_status() RETURNS TABLE(id text,status text,attempts integer,last_error text)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
        SELECT id::text,status::text,attempts,last_error::text FROM public.signup_notifications ORDER BY next_attempt_at DESC LIMIT 200;
      $$"""
    }
    for signature, sql in functions.items():
      op.execute(sql); op.execute(f"REVOKE ALL ON FUNCTION koma_internal.{signature} FROM PUBLIC"); op.execute(f"GRANT EXECUTE ON FUNCTION koma_internal.{signature} TO koma_app")

def downgrade():
    if op.get_bind().dialect.name == 'postgresql':
      for signature in ('retry_signup_notification(text)', 'claim_signup_notifications(text)', 'settle_signup_notification(text,text,text,text,timestamptz)', 'signup_delivery_status()'):
        op.execute(f"DROP FUNCTION IF EXISTS koma_internal.{signature}")
    op.drop_table('signup_notifications')
