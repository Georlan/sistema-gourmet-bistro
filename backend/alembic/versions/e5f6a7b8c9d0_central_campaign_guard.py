"""Prepare central campaigns with verified interaction and a shared daily cap."""
from alembic import op
import sqlalchemy as sa
revision = "e5f6a7b8c9d0"
down_revision = "d4e5f6a7b8c9"
branch_labels = None
depends_on = None


def upgrade():
    for column in [
        sa.Column("whatsapp_interaction_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("whatsapp_interaction_phone_hash", sa.String(64), nullable=True),
        sa.Column("whatsapp_marketing_opt_in", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("whatsapp_campaign_last_sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("whatsapp_campaign_last_event_id", sa.String(36), nullable=True),
    ]: op.add_column("crm_clientes_preferencias", column)
    op.add_column("central_whatsapp_sender_state", sa.Column("campaign_day", sa.String(10), nullable=True))
    op.add_column("central_whatsapp_sender_state", sa.Column("campaign_attempts", sa.Integer(), nullable=False, server_default="0"))


def downgrade():
    op.drop_column("central_whatsapp_sender_state", "campaign_attempts")
    op.drop_column("central_whatsapp_sender_state", "campaign_day")
    for name in ["whatsapp_campaign_last_event_id", "whatsapp_campaign_last_sent_at", "whatsapp_marketing_opt_in", "whatsapp_interaction_phone_hash", "whatsapp_interaction_at"]:
        op.drop_column("crm_clientes_preferencias", name)
