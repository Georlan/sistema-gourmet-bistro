"""add outbox claim locking columns and stale index

Revision ID: f6b2c3d4e5f6
Revises: f6a1b2c3d4e5
Create Date: 2026-08-30 12:15:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'f6b2c3d4e5f6'
down_revision = 'f6a1b2c3d4e5'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('integration_outbox', schema=None) as batch_op:
        batch_op.add_column(sa.Column('locked_at', sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column('locked_by', sa.String(length=64), nullable=True))
        batch_op.create_index('ix_integration_outbox_processing_stale', ['status', 'locked_at'], unique=False)


def downgrade():
    with op.batch_alter_table('integration_outbox', schema=None) as batch_op:
        batch_op.drop_index('ix_integration_outbox_processing_stale')
        batch_op.drop_column('locked_by')
        batch_op.drop_column('locked_at')
