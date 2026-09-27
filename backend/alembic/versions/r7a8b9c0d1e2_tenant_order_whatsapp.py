"""Optional, tenant-owned operational WhatsApp alerts."""

from alembic import op
import sqlalchemy as sa

revision = "r7a8b9c0d1e2"
down_revision = "q6f7a8b9c0d1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("configuracoes_restaurante", sa.Column("whatsapp_alerts_enabled", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("configuracoes_restaurante", sa.Column("whatsapp_instance_name", sa.String(100), nullable=True))
    op.add_column("configuracoes_restaurante", sa.Column("whatsapp_recipient_phone", sa.String(16), nullable=True))
    op.add_column("configuracoes_restaurante", sa.Column("whatsapp_next_send_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("configuracoes_restaurante", sa.Column("whatsapp_consecutive_failures", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("configuracoes_restaurante", sa.Column("whatsapp_circuit_open_until", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("configuracoes_restaurante", "whatsapp_circuit_open_until")
    op.drop_column("configuracoes_restaurante", "whatsapp_consecutive_failures")
    op.drop_column("configuracoes_restaurante", "whatsapp_next_send_at")
    op.drop_column("configuracoes_restaurante", "whatsapp_recipient_phone")
    op.drop_column("configuracoes_restaurante", "whatsapp_instance_name")
    op.drop_column("configuracoes_restaurante", "whatsapp_alerts_enabled")
