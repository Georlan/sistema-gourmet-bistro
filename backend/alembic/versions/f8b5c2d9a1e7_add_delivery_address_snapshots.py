"""add immutable delivery address snapshots

Revision ID: f8b5c2d9a1e7
Revises: f8b7c6d5e4a3
"""

from alembic import op
import sqlalchemy as sa


revision = "f8b5c2d9a1e7"
down_revision = "f8b7c6d5e4a3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "comanda_delivery_address_snapshots",
        sa.Column("comanda_id", sa.String(), nullable=False),
        sa.Column("restaurante_id", sa.Integer(), nullable=False),
        sa.Column("payload_encrypted", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["comanda_id"],
            ["comandas.id"],
            name="fk_delivery_address_snapshot_comanda",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["restaurante_id"],
            ["restaurantes.id"],
            name="fk_delivery_address_snapshot_restaurante",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("comanda_id"),
    )
    op.create_index(
        "ix_comanda_delivery_address_snapshots_restaurante_id",
        "comanda_delivery_address_snapshots",
        ["restaurante_id"],
        unique=False,
    )
    op.create_index(
        "ix_comanda_delivery_address_snapshots_tenant_order",
        "comanda_delivery_address_snapshots",
        ["restaurante_id", "comanda_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_comanda_delivery_address_snapshots_tenant_order",
        table_name="comanda_delivery_address_snapshots",
    )
    op.drop_index(
        "ix_comanda_delivery_address_snapshots_restaurante_id",
        table_name="comanda_delivery_address_snapshots",
    )
    op.drop_table("comanda_delivery_address_snapshots")
