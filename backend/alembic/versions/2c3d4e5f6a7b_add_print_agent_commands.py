"""add print agent commands

Revision ID: 2c3d4e5f6a7b
Revises: 1b2c3d4e5f6a
Create Date: 2026-07-29 23:20:00

Adds one bounded pending command and its latest result to each authenticated
print agent. This lets the cloud panel ask the background service to rescan
and connect a physical USB printer without creating an unbounded event table.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "2c3d4e5f6a7b"
down_revision: Union[str, Sequence[str], None] = "1b2c3d4e5f6a"
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
            "pending_command",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )
    op.add_column(
        "print_agent_tokens",
        sa.Column(
            "command_requested_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.add_column(
        "print_agent_tokens",
        sa.Column(
            "last_command_result",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )
    op.add_column(
        "print_agent_tokens",
        sa.Column(
            "command_completed_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    op.drop_column("print_agent_tokens", "command_completed_at")
    op.drop_column("print_agent_tokens", "last_command_result")
    op.drop_column("print_agent_tokens", "command_requested_at")
    op.drop_column("print_agent_tokens", "pending_command")
