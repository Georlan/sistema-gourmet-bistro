"""Add encrypted per-order delivery receipts; existing orders stay compatible."""
from alembic import op
import sqlalchemy as sa

revision = 'f7b8c9d0e1f2'
down_revision = 'f6a7b8c9d0e1'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('comandas', sa.Column('delivery_receipt_secret', sa.String(), nullable=True))
    op.add_column('comandas', sa.Column('delivery_receipt_failed_attempts', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('comandas', sa.Column('delivery_receipt_retry_at', sa.DateTime(), nullable=True))


def downgrade():
    op.drop_column('comandas', 'delivery_receipt_retry_at')
    op.drop_column('comandas', 'delivery_receipt_failed_attempts')
    op.drop_column('comandas', 'delivery_receipt_secret')
