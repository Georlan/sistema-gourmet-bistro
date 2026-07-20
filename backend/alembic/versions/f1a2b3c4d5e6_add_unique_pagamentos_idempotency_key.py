"""add_unique_pagamentos_idempotency_key

Revision ID: f1a2b3c4d5e6
Revises: 8f3a2d1c9e7b
Create Date: 2026-07-19 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f1a2b3c4d5e6'
down_revision: Union[str, Sequence[str], None] = '8f3a2d1c9e7b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Cria índice único para evitar pagamentos duplicados por idempotency_key."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table('pagamentos'):
        indexes = [idx['name'] for idx in inspector.get_indexes('pagamentos')]
        if 'ix_pagamentos_idempotency_key' not in indexes:
            with op.batch_alter_table('pagamentos') as batch_op:
                batch_op.create_index('ix_pagamentos_idempotency_key', ['idempotency_key'], unique=True)
            print("✅ Índice único ix_pagamentos_idempotency_key criado com sucesso.")
        else:
            print("⚠️ Índice ix_pagamentos_idempotency_key já existe. Ignorando criação.")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table('pagamentos'):
        indexes = [idx['name'] for idx in inspector.get_indexes('pagamentos')]
        if 'ix_pagamentos_idempotency_key' in indexes:
            with op.batch_alter_table('pagamentos') as batch_op:
                batch_op.drop_index('ix_pagamentos_idempotency_key')
            print("✅ Índice único ix_pagamentos_idempotency_key removido com sucesso.")
