"""Persist central sender suspension and new-events-only resumption.

Revision ID: d4e5f6a7b8c9
Revises: c2f3a4b5d6e7
"""
from alembic import op
import sqlalchemy as sa
revision = "d4e5f6a7b8c9"
down_revision = "c2f3a4b5d6e7"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("central_whatsapp_sender_state", sa.Column("suspended_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("central_whatsapp_sender_state", sa.Column("accept_events_after", sa.DateTime(timezone=True), nullable=True))


def downgrade():
    op.drop_column("central_whatsapp_sender_state", "accept_events_after")
    op.drop_column("central_whatsapp_sender_state", "suspended_at")
