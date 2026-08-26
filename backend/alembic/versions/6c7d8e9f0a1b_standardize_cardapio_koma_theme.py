"""standardize digital menu visual to the Koma theme

Revision ID: 6c7d8e9f0a1b
Revises: 5b6c7d8e9f0a
Create Date: 2026-08-26 18:20:00.000000
"""
from typing import Sequence, Union

from alembic import op


revision: str = "6c7d8e9f0a1b"
down_revision: Union[str, Sequence[str], None] = "5b6c7d8e9f0a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Normalize legacy restaurant menu colors to the fixed Koma palette."""
    op.execute(
        """
        UPDATE restaurantes
        SET cor_primaria = '#00b894',
            cor_fundo = '#090a0f'
        WHERE cor_primaria IS NULL
           OR cor_primaria <> '#00b894'
           OR cor_fundo IS NULL
           OR cor_fundo <> '#090a0f'
        """
    )


def downgrade() -> None:
    # Previous arbitrary per-restaurant colors cannot be reconstructed safely.
    pass
