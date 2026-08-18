"""bind SmartPOS provider operation to a terminal

Revision ID: e1c3a5b7d902
Revises: d9b2c4e6f801
Create Date: 2026-08-18
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e1c3a5b7d902"
down_revision: Union[str, Sequence[str], None] = "d9b2c4e6f801"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("smartpos_payment_intents") as batch_op:
        batch_op.add_column(sa.Column("provider_terminal_id", sa.String(length=64), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("smartpos_payment_intents") as batch_op:
        batch_op.drop_column("provider_terminal_id")
