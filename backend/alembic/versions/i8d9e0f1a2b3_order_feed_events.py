"""Separate durable order feed events from human messages.

Revision ID: i8d9e0f1a2b3
Revises: h7c8d9e0f1a2
"""
from alembic import op
import sqlalchemy as sa

revision = "i8d9e0f1a2b3"
down_revision = "h7c8d9e0f1a2"
branch_labels = None
depends_on = None


def upgrade():
    if op.get_bind().dialect.name == "postgresql":
        # Fail closed if the migration role cannot see every tenant row.
        op.execute("SET LOCAL row_security = off")
        # Prevent a legacy writer from inserting between the copy and delete.
        op.execute("LOCK TABLE order_messages IN ACCESS EXCLUSIVE MODE")
    op.create_table(
        "order_conversation_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("restaurante_id", sa.Integer(), sa.ForeignKey("restaurantes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("conversation_id", sa.String(36), sa.ForeignKey("order_conversations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("pedido_id", sa.String(64), nullable=False),
        sa.Column("event_key", sa.String(64)),
        sa.Column("status", sa.String(32)),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("body_format", sa.String(32), server_default="plain_text_v2", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("conversation_id", "event_key", name="uq_order_conversation_events_key"),
    )
    op.create_index("ix_order_conversation_events_feed", "order_conversation_events", ["conversation_id", "created_at"])
    # Preserve IDs, text encoding and timestamps: old bookmarks/deduplication remain valid.
    op.execute("""
        INSERT INTO order_conversation_events
            (id, restaurante_id, conversation_id, pedido_id, event_key, status, body, body_format, created_at)
        SELECT id, restaurante_id, conversation_id, pedido_id, event_key,
            CASE WHEN event_key LIKE 'status:%' THEN substr(event_key, 8) ELSE NULL END,
            body, body_format, created_at
        FROM order_messages WHERE sender_type = 'system'
    """)
    op.execute("DELETE FROM order_messages WHERE sender_type = 'system'")
    if op.get_bind().dialect.name == "sqlite":
        op.execute("UPDATE order_messages SET client_message_id = replace(client_message_id, '-', '') WHERE client_message_id IS NOT NULL")
    with op.batch_alter_table("order_messages") as batch:
        batch.alter_column("client_message_id", existing_type=sa.String(64),
                           type_=sa.Uuid(as_uuid=False), postgresql_using="client_message_id::uuid")
        batch.drop_constraint("ck_order_messages_sender_type", type_="check")
        batch.create_check_constraint("ck_order_messages_sender_type", "sender_type IN ('customer', 'staff')")
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE order_conversation_events ENABLE ROW LEVEL SECURITY")
        op.execute("ALTER TABLE order_conversation_events FORCE ROW LEVEL SECURITY")
        op.execute("REVOKE ALL ON order_conversation_events FROM PUBLIC")
        op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON order_conversation_events TO koma_app")
        tenant = "restaurante_id = NULLIF(current_setting('app.current_restaurante_id', true), '')::integer"
        op.execute(f"CREATE POLICY order_conversation_events_tenant ON order_conversation_events TO koma_app USING ({tenant}) WITH CHECK ({tenant})")


def downgrade():
    if op.get_bind().dialect.name == "postgresql":
        op.execute("SET LOCAL row_security = off")
        op.execute("LOCK TABLE order_messages, order_conversation_events IN ACCESS EXCLUSIVE MODE")
    with op.batch_alter_table("order_messages") as batch:
        batch.alter_column("client_message_id", existing_type=sa.Uuid(as_uuid=False),
                           type_=sa.String(64), postgresql_using="client_message_id::text")
        batch.drop_constraint("ck_order_messages_sender_type", type_="check")
        batch.create_check_constraint("ck_order_messages_sender_type", "sender_type IN ('customer', 'staff', 'system')")
    if op.get_bind().dialect.name == "sqlite":
        op.execute("UPDATE order_messages SET client_message_id = substr(client_message_id,1,8) || '-' || substr(client_message_id,9,4) || '-' || substr(client_message_id,13,4) || '-' || substr(client_message_id,17,4) || '-' || substr(client_message_id,21,12) WHERE length(client_message_id) = 32")
    op.execute("""
        INSERT INTO order_messages
            (id, restaurante_id, conversation_id, pedido_id, sender_type, event_key, body, body_format, created_at)
        SELECT id, restaurante_id, conversation_id, pedido_id, 'system', event_key, body, body_format, created_at
        FROM order_conversation_events
    """)
    op.drop_table("order_conversation_events")
