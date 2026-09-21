"""add dedicated idempotency key to human order chat messages

Revision ID: h7c8d9e0f1a2
Revises: g6b7c8d9e0f1
Create Date: 2026-09-19 12:55:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "h7c8d9e0f1a2"
down_revision = "g6b7c8d9e0f1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("order_messages") as batch:
        batch.add_column(sa.Column("client_message_id", sa.String(length=64), nullable=True))
        batch.create_unique_constraint(
            "uq_order_messages_conv_client_message_id",
            ["conversation_id", "client_message_id"],
        )


def downgrade() -> None:
    with op.batch_alter_table("order_messages") as batch:
        batch.drop_constraint(
            "uq_order_messages_conv_client_message_id",
            type_="unique",
        )
        batch.drop_column("client_message_id")
