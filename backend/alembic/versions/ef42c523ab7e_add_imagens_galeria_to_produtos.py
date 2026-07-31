"""add_imagens_galeria_to_produtos

Revision ID: ef42c523ab7e
Revises: 2c3d4e5f6a7b
Create Date: 2026-07-31 16:00:16.528505

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ef42c523ab7e'
down_revision: Union[str, Sequence[str], None] = '2c3d4e5f6a7b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = [c['name'] for c in inspector.get_columns('produtos')]
    if 'imagens_galeria' not in cols:
        with op.batch_alter_table('produtos') as batch_op:
            batch_op.add_column(sa.Column('imagens_galeria', sa.JSON(), server_default='[]', nullable=False))


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = [c['name'] for c in inspector.get_columns('produtos')]
    if 'imagens_galeria' in cols:
        with op.batch_alter_table('produtos') as batch_op:
            batch_op.drop_column('imagens_galeria')

