"""store order chat as plain text and index active conversations

Revision ID: 4c5d6e7f8091
Revises: 3b4c5d6e7f80
Create Date: 2026-09-08 14:20:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "4c5d6e7f8091"
down_revision = "3b4c5d6e7f80"
branch_labels = None
depends_on = None


LEGACY_BODY_FORMAT = "html_escaped_v1"
PLAIN_BODY_FORMAT = "plain_text_v2"


def upgrade() -> None:
    bind = op.get_bind()

    # Existing rows were persisted through html.escape(). Tag them explicitly so
    # the API can decode only historical records while every new message remains
    # plain text end-to-end.
    op.add_column(
        "order_messages",
        sa.Column(
            "body_format",
            sa.String(length=32),
            nullable=False,
            server_default=LEGACY_BODY_FORMAT,
        ),
    )

    # PostgreSQL is production and can safely switch the DB fallback for future
    # raw inserts. SQLite keeps the legacy fallback because ALTER DEFAULT is not
    # supported directly there; ORM inserts still always write plain_text_v2.
    if bind.dialect.name == "postgresql":
        op.alter_column(
            "order_messages",
            "body_format",
            existing_type=sa.String(length=32),
            nullable=False,
            server_default=PLAIN_BODY_FORMAT,
        )

    op.create_index(
        "ix_order_conversations_tenant_open_updated",
        "order_conversations",
        ["restaurante_id", "closed_at", "updated_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_order_conversations_tenant_open_updated",
        table_name="order_conversations",
    )
    op.drop_column("order_messages", "body_format")
