"""Freeze the restaurant-specific due date on new direct-Pix invoices."""
from alembic import op
import sqlalchemy as sa

revision = 'ba8d7c6e5f41'
down_revision = '099cff37c89d'
branch_labels = None
depends_on = None


def upgrade():
    if op.get_bind().dialect.name == 'postgresql':
        op.execute("SET LOCAL lock_timeout = '2s'")
        op.execute("SET LOCAL statement_timeout = '30s'")
    op.add_column('direct_pix_fee_invoices', sa.Column('due_at', sa.DateTime(timezone=True), nullable=True))


def downgrade():
    if op.get_bind().execute(sa.text('SELECT count(*) FROM direct_pix_fee_invoices WHERE due_at IS NOT NULL')).scalar():
        raise RuntimeError('Preserve os vencimentos das faturas emitidas antes de reverter.')
    op.drop_column('direct_pix_fee_invoices', 'due_at')
