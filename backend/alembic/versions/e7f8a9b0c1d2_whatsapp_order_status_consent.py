"""add order-scoped WhatsApp status consent, disabled for all existing orders

Revision ID: e7f8a9b0c1d2
Revises: 1370ca2f0151
"""
from alembic import op
import sqlalchemy as sa

revision = "e7f8a9b0c1d2"
down_revision = "1370ca2f0151"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "comandas",
        sa.Column(
            "whatsapp_status_opt_in",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("comandas", "whatsapp_status_opt_in")
