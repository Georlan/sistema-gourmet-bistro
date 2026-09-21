"""Add durable order-chat feed sequence and retention marker.

Revision ID: j9e0f1a2b3c4
Revises: i8d9e0f1a2b3
"""
from alembic import op
import sqlalchemy as sa

revision = "j9e0f1a2b3c4"
down_revision = "i8d9e0f1a2b3"
branch_labels = None
depends_on = None


def upgrade():
    if op.get_bind().dialect.name == "postgresql":
        op.execute("SET LOCAL row_security = off")
        op.execute("LOCK TABLE order_conversations, order_messages, order_conversation_events IN ACCESS EXCLUSIVE MODE")
    with op.batch_alter_table("order_conversations") as batch:
        batch.add_column(sa.Column("next_feed_seq", sa.Integer(), server_default="1", nullable=False))
        batch.add_column(sa.Column("chat_purged_at", sa.DateTime(timezone=True)))
    with op.batch_alter_table("order_messages") as batch:
        batch.add_column(sa.Column("feed_seq", sa.Integer()))
    with op.batch_alter_table("order_conversation_events") as batch:
        batch.add_column(sa.Column("feed_seq", sa.Integer()))

    op.execute("""
        WITH ranked AS (
          SELECT id, kind, ROW_NUMBER() OVER (
            PARTITION BY conversation_id ORDER BY created_at, id
          ) AS seq
          FROM (
            SELECT id, conversation_id, created_at, 'message' AS kind FROM order_messages
            UNION ALL
            SELECT id, conversation_id, created_at, 'event' AS kind FROM order_conversation_events
          ) feed
        )
        UPDATE order_messages SET feed_seq = (
          SELECT seq FROM ranked WHERE ranked.id = order_messages.id AND ranked.kind = 'message'
        )
    """)
    op.execute("""
        WITH ranked AS (
          SELECT id, kind, ROW_NUMBER() OVER (
            PARTITION BY conversation_id ORDER BY created_at, id
          ) AS seq
          FROM (
            SELECT id, conversation_id, created_at, 'message' AS kind FROM order_messages
            UNION ALL
            SELECT id, conversation_id, created_at, 'event' AS kind FROM order_conversation_events
          ) feed
        )
        UPDATE order_conversation_events SET feed_seq = (
          SELECT seq FROM ranked WHERE ranked.id = order_conversation_events.id AND ranked.kind = 'event'
        )
    """)
    op.execute("""
        UPDATE order_conversations SET next_feed_seq = 1 + COALESCE((
          SELECT MAX(seq) FROM (
            SELECT feed_seq AS seq FROM order_messages WHERE conversation_id = order_conversations.id
            UNION ALL
            SELECT feed_seq AS seq FROM order_conversation_events WHERE conversation_id = order_conversations.id
          ) values_
        ), 0)
    """)
    with op.batch_alter_table("order_messages") as batch:
        batch.alter_column("feed_seq", existing_type=sa.Integer(), nullable=False)
        batch.create_unique_constraint("uq_order_messages_conv_feed_seq", ["conversation_id", "feed_seq"])
    with op.batch_alter_table("order_conversation_events") as batch:
        batch.alter_column("feed_seq", existing_type=sa.Integer(), nullable=False)
        batch.create_unique_constraint("uq_order_events_conv_feed_seq", ["conversation_id", "feed_seq"])


def downgrade():
    with op.batch_alter_table("order_conversation_events") as batch:
        batch.drop_constraint("uq_order_events_conv_feed_seq", type_="unique")
        batch.drop_column("feed_seq")
    with op.batch_alter_table("order_messages") as batch:
        batch.drop_constraint("uq_order_messages_conv_feed_seq", type_="unique")
        batch.drop_column("feed_seq")
    with op.batch_alter_table("order_conversations") as batch:
        batch.drop_column("chat_purged_at")
        batch.drop_column("next_feed_seq")
