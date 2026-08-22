"""link smartpos intent to table service

Revision ID: 0c9946a3c7bb
Revises: a7c4e9d2f610
Create Date: 2026-08-22 09:38:54.269546

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0c9946a3c7bb"
down_revision: Union[str, Sequence[str], None] = "a7c4e9d2f610"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("smartpos_payment_intents") as batch_op:
        batch_op.add_column(sa.Column("atendimento_id", sa.String(), nullable=True))
        batch_op.create_foreign_key(
            "fk_smartpos_intent_atendimento",
            "atendimentos_mesa",
            ["atendimento_id"],
            ["id"],
            ondelete="RESTRICT",
        )
        batch_op.create_index(
            "ix_smartpos_intent_tenant_atendimento_status",
            ["restaurante_id", "atendimento_id", "status"],
            unique=False,
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("smartpos_payment_intents") as batch_op:
        batch_op.drop_index("ix_smartpos_intent_tenant_atendimento_status")
        batch_op.drop_constraint(
            "fk_smartpos_intent_atendimento",
            type_="foreignkey",
        )
        batch_op.drop_column("atendimento_id")
