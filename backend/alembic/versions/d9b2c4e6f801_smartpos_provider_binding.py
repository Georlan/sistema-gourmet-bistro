"""add SmartPOS provider binding metadata

Revision ID: d9b2c4e6f801
Revises: c8a1f7d2e604
Create Date: 2026-08-18
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d9b2c4e6f801"
down_revision: Union[str, Sequence[str], None] = "c8a1f7d2e604"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("smartpos_payment_intents") as batch_op:
        batch_op.add_column(sa.Column("provider_name", sa.String(length=32), nullable=True))
        batch_op.add_column(sa.Column("provider_operation_key", sa.String(length=128), nullable=True))
        batch_op.add_column(sa.Column("provider_reference", sa.String(length=128), nullable=True))
        batch_op.add_column(sa.Column("provider_last_error", sa.String(length=255), nullable=True))
        batch_op.create_unique_constraint(
            "uq_smartpos_intent_provider_operation",
            ["restaurante_id", "provider_name", "provider_operation_key"],
        )


def downgrade() -> None:
    with op.batch_alter_table("smartpos_payment_intents") as batch_op:
        batch_op.drop_constraint("uq_smartpos_intent_provider_operation", type_="unique")
        batch_op.drop_column("provider_last_error")
        batch_op.drop_column("provider_reference")
        batch_op.drop_column("provider_operation_key")
        batch_op.drop_column("provider_name")
