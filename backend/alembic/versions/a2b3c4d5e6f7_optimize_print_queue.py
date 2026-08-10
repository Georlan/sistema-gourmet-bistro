"""optimize print queue claims and bounded recovery

Revision ID: a2b3c4d5e6f7
Revises: f2a3b4c5d6e7
Create Date: 2026-08-10 17:10:00.000000
"""
from typing import Sequence, Union

from alembic import op


revision: str = "a2b3c4d5e6f7"
down_revision: Union[str, Sequence[str], None] = "f2a3b4c5d6e7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_print_jobs_tenant_pending_fifo
        ON public.print_jobs (restaurante_id, created_at, id)
        WHERE status = 'pending'
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_print_jobs_tenant_status_created
        ON public.print_jobs (restaurante_id, status, created_at)
    """)


def downgrade() -> None:
    op.execute(
        "DROP INDEX IF EXISTS public.ix_print_jobs_tenant_status_created"
    )
    op.execute(
        "DROP INDEX IF EXISTS public.ix_print_jobs_tenant_pending_fifo"
    )
