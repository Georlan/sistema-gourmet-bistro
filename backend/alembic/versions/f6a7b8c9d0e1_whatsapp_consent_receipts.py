"""Authenticated, phone-bound consent receipts; no implicit permissions."""
from alembic import op
import sqlalchemy as sa
revision="f6a7b8c9d0e1"
down_revision="e5f6a7b8c9d0"
branch_labels=None
depends_on=None


def upgrade():
    for column in [
        sa.Column("whatsapp_consent_nonce_hash",sa.String(64),nullable=True),
        sa.Column("whatsapp_consent_expires_at",sa.DateTime(timezone=True),nullable=True),
        sa.Column("whatsapp_consent_message_hash",sa.String(64),nullable=True),
        sa.Column("whatsapp_marketing_consented_at",sa.DateTime(timezone=True),nullable=True),
    ]: op.add_column("crm_clientes_preferencias",column)
    op.create_index("ix_crm_whatsapp_consent_nonce","crm_clientes_preferencias",["restaurante_id","whatsapp_consent_nonce_hash"],unique=True)


def downgrade():
    if op.get_bind().execute(sa.text("SELECT 1 FROM crm_clientes_preferencias WHERE whatsapp_marketing_consented_at IS NOT NULL LIMIT 1")).scalar():
        raise RuntimeError("Preserve os comprovantes de consentimento antes de remover sua auditoria.")
    op.drop_index("ix_crm_whatsapp_consent_nonce",table_name="crm_clientes_preferencias")
    for name in ("whatsapp_marketing_consented_at","whatsapp_consent_message_hash","whatsapp_consent_expires_at","whatsapp_consent_nonce_hash"):
        op.drop_column("crm_clientes_preferencias",name)
