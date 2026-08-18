"""link approved SmartPOS intents to canonical payments

Revision ID: f2d4e6a8b013
Revises: e1c3a5b7d902
Create Date: 2026-08-18
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f2d4e6a8b013"
down_revision: Union[str, Sequence[str], None] = "e1c3a5b7d902"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("smartpos_payment_intents") as batch_op:
        batch_op.add_column(sa.Column("pagamento_id", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("liquidado_em", sa.DateTime(timezone=True), nullable=True))
        batch_op.create_foreign_key(
            "fk_smartpos_intent_pagamento",
            "pagamentos",
            ["pagamento_id"],
            ["id"],
            ondelete="RESTRICT",
        )
        batch_op.create_unique_constraint(
            "uq_smartpos_intent_pagamento",
            ["pagamento_id"],
        )


def downgrade() -> None:
    with op.batch_alter_table("smartpos_payment_intents") as batch_op:
        batch_op.drop_constraint("uq_smartpos_intent_pagamento", type_="unique")
        batch_op.drop_constraint("fk_smartpos_intent_pagamento", type_="foreignkey")
        batch_op.drop_column("liquidado_em")
        batch_op.drop_column("pagamento_id")
