"""worker_due_tenant_discovery

Revision ID: be7821a1b10a
Revises: z8e9f0a1b2c3
Create Date: 2026-10-03 00:45:01.532509

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'be7821a1b10a'
down_revision: Union[str, Sequence[str], None] = 'z8e9f0a1b2c3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute("""
        CREATE INDEX ix_outbox_global_due ON public.integration_outbox
        (next_retry_at, restaurante_id) WHERE status IN ('pending', 'failed')
    """)
    op.execute("""
        CREATE INDEX ix_scheduled_global_due ON public.scheduled_orders
        (scheduled_for, restaurante_id) WHERE released_at IS NULL
    """)
    # Cross-tenant discovery is necessary here, just as in list_public_restaurants.
    # It exposes only IDs the backend already can enumerate, never event payloads.
    op.execute("""
        CREATE FUNCTION koma_internal.worker_due_restaurants(
            due_at timestamptz, stale_before timestamptz
        ) RETURNS TABLE (id integer)
        LANGUAGE sql SECURITY DEFINER STABLE
        SET search_path = pg_catalog
        AS $$
            SELECT work.restaurante_id FROM (
                SELECT restaurante_id FROM public.integration_outbox
                WHERE status IN ('pending', 'failed')
                  AND (next_retry_at IS NULL OR next_retry_at <= due_at)
                UNION
                SELECT restaurante_id FROM public.integration_outbox
                WHERE status = 'processing'
                  AND (locked_at IS NULL OR locked_at <= stale_before)
                UNION
                SELECT restaurante_id FROM public.scheduled_orders
                WHERE released_at IS NULL AND scheduled_for <= due_at
            ) AS work
            WHERE pg_has_role(session_user, 'koma_app', 'member')
        $$
    """)
    op.execute("REVOKE ALL ON FUNCTION koma_internal.worker_due_restaurants(timestamptz, timestamptz) FROM PUBLIC")
    op.execute("GRANT EXECUTE ON FUNCTION koma_internal.worker_due_restaurants(timestamptz, timestamptz) TO koma_app")


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute("DROP FUNCTION koma_internal.worker_due_restaurants(timestamptz, timestamptz)")
    op.drop_index("ix_scheduled_global_due", table_name="scheduled_orders", schema="public")
    op.drop_index("ix_outbox_global_due", table_name="integration_outbox", schema="public")
