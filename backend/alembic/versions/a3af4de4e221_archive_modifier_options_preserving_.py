"""archive modifier options preserving order history

Revision ID: a3af4de4e221
Revises: 9a4e7c2d1b6f
Create Date: 2026-10-05 11:34:06.772614

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a3af4de4e221'
down_revision: Union[str, Sequence[str], None] = '9a4e7c2d1b6f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("opcao_modificadores", sa.Column("arquivada", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("opcao_modificadores", "arquivada")
