"""create_clientes_table

Revision ID: 4de38de3c004
Revises: 8f3a2d1c9e7b
Create Date: 2026-07-12 13:35:47.105483

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4de38de3c004'
down_revision: Union[str, Sequence[str], None] = '8f3a2d1c9e7b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()
    if 'clientes' not in tables:
        op.create_table(
            'clientes',
            sa.Column('telefone', sa.String(), primary_key=True),
            sa.Column('nome', sa.String(), nullable=False),
            sa.Column('criado_em', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP'))
        )


def downgrade() -> None:
    """Downgrade schema."""
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()
    if 'clientes' in tables:
        op.drop_table('clientes')
