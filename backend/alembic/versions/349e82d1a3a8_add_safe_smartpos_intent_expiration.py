"""add safe SmartPOS intent expiration

Revision ID: 349e82d1a3a8
Revises: 0c9946a3c7bb
Create Date: 2026-08-22 09:52:26.440881

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "349e82d1a3a8"
down_revision: Union[str, Sequence[str], None] = "0c9946a3c7bb"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("smartpos_payment_intents") as batch_op:
        batch_op.add_column(
            sa.Column("expira_em", sa.DateTime(timezone=True), nullable=True)
        )
        batch_op.create_index(
            "ix_smartpos_intent_tenant_status_expira",
            ["restaurante_id", "status", "expira_em"],
            unique=False,
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("smartpos_payment_intents") as batch_op:
        batch_op.drop_index("ix_smartpos_intent_tenant_status_expira")
        batch_op.drop_column("expira_em")
