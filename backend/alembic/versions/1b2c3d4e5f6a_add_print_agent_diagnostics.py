"""add print agent diagnostics

Revision ID: 1b2c3d4e5f6a
Revises: 0f1e2d3c4b5a
Create Date: 2026-07-29 11:20:00

Stores the latest bounded printer snapshot reported by each authenticated
local connector. The existing tenant RLS on print_agent_tokens continues to
protect the row; no new history table or unbounded event stream is created.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "1b2c3d4e5f6a"
down_revision: Union[str, Sequence[str], None] = "0f1e2d3c4b5a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    op.execute("SET LOCAL lock_timeout = '5s'")
    op.add_column(
        "print_agent_tokens",
        sa.Column(
            "printer_diagnostics",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )
    op.add_column(
        "print_agent_tokens",
        sa.Column(
            "diagnostics_updated_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    op.drop_column("print_agent_tokens", "diagnostics_updated_at")
    op.drop_column("print_agent_tokens", "printer_diagnostics")
