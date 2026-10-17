"""Durable WhatsApp transport observability without phone or message payloads.

Revision ID: a15b76e83c90
Revises: f4b871c2d390
"""
from alembic import op
import sqlalchemy as sa

revision = "a15b76e83c90"
down_revision = "f4b871c2d390"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "whatsapp_usage_metrics",
        sa.Column("restaurante_id", sa.Integer(), sa.ForeignKey("restaurantes.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("month_utc", sa.String(7), primary_key=True),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("accepted", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("failed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("discarded", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("deferred", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("queue_latency_total_ms", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("queue_latency_samples", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("estimated_customer_cost_brl", sa.Numeric(14, 4), nullable=False, server_default="0"),
    )
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE public.whatsapp_usage_metrics ENABLE ROW LEVEL SECURITY")
        op.execute("ALTER TABLE public.whatsapp_usage_metrics FORCE ROW LEVEL SECURITY")
        op.execute("REVOKE ALL ON public.whatsapp_usage_metrics FROM PUBLIC")
        op.execute("""DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'koma_app') THEN
                GRANT SELECT, INSERT, UPDATE ON public.whatsapp_usage_metrics TO koma_app;
            END IF;
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
                REVOKE ALL ON public.whatsapp_usage_metrics FROM anon;
            END IF;
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
                REVOKE ALL ON public.whatsapp_usage_metrics FROM authenticated;
            END IF;
        END $$;""")
        op.execute("""CREATE POLICY whatsapp_usage_tenant ON public.whatsapp_usage_metrics
            USING (restaurante_id = NULLIF(current_setting('app.current_restaurante_id', true), '')::integer)
            WITH CHECK (restaurante_id = NULLIF(current_setting('app.current_restaurante_id', true), '')::integer)""")


def downgrade():
    # Do not accidentally erase durable historical counters.
    raise RuntimeError("WhatsApp usage metrics downgrade would destroy historical usage counters.")
