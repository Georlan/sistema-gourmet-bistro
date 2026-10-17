"""Default-off tenant permission for transactional customer WhatsApp notices.

Revision ID: f4b871c2d390
Revises: 099a95caaff7
"""
from alembic import op
import sqlalchemy as sa

revision = 'f4b871c2d390'
down_revision = '099a95caaff7'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'configuracoes_restaurante',
        sa.Column('whatsapp_customer_notices_enabled', sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade():
    op.drop_column('configuracoes_restaurante', 'whatsapp_customer_notices_enabled')
