"""add delivery area policy and order acquisition attribution

Revision ID: a9f0b1c2d3e4
Revises: z8e9f0a1b2c3
Create Date: 2026-10-05
"""

from alembic import op
import sqlalchemy as sa


revision = "a9f0b1c2d3e4"
down_revision = "z8e9f0a1b2c3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "configuracoes_restaurante",
        sa.Column("delivery_area_policy", sa.JSON(), nullable=True),
    )
    op.add_column(
        "comandas",
        sa.Column("acquisition_attribution", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("comandas", "acquisition_attribution")
    op.drop_column("configuracoes_restaurante", "delivery_area_policy")
