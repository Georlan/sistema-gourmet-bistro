"""add delivery area policy and order acquisition attribution

Revision ID: w3a4b5c6d7e8
Revises: v2f3a4b5c6d7
Create Date: 2026-10-05
"""

from alembic import op
import sqlalchemy as sa


revision = "w3a4b5c6d7e8"
down_revision = "v2f3a4b5c6d7"
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
