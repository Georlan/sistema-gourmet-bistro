"""Customer session revocation after password recovery.

Revision ID: 3b4c5d6e7f80
Revises: 2a3b4c5d6e7f
"""
from alembic import op
import sqlalchemy as sa

revision = '3b4c5d6e7f80'
down_revision = '2a3b4c5d6e7f'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('clientes', sa.Column('password_reset_at', sa.DateTime(timezone=True), nullable=True))


def downgrade():
    op.drop_column('clientes', 'password_reset_at')
