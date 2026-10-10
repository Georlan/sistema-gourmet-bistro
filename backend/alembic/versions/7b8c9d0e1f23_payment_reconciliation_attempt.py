"""Persist polling attempts independently from payment changes."""
from alembic import op
import sqlalchemy as sa
revision = '7b8c9d0e1f23'
down_revision = '6a7b8c9d0e12'
branch_labels = None
depends_on = None


def upgrade():
    if op.get_bind().dialect.name == 'postgresql':
        op.execute("SET LOCAL lock_timeout = '2s'")
    op.add_column('online_payment_intents', sa.Column('reconciliation_attempted_at', sa.DateTime(timezone=True), nullable=True))


def downgrade():
    op.drop_column('online_payment_intents', 'reconciliation_attempted_at')
