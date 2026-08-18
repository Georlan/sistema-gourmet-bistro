"""add SmartPOS payment method capture mode

Revision ID: b7d3f1a8c902
Revises: a6c2e9f4b8d1
Create Date: 2026-08-18
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b7d3f1a8c902"
down_revision: Union[str, Sequence[str], None] = "a6c2e9f4b8d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_NEW_METHODS = "metodo IN ('dinheiro', 'pix', 'debito', 'credito', 'voucher', 'cartao')"
_OLD_METHODS = "metodo IN ('dinheiro', 'pix', 'cartao')"
_CAPTURE_MODES = "captura IN ('provider_integrado', 'dinheiro_pendente', 'registro_externo')"


def upgrade() -> None:
    with op.batch_alter_table("smartpos_payment_intents") as batch_op:
        batch_op.add_column(
            sa.Column(
                "captura",
                sa.String(length=24),
                nullable=False,
                server_default="provider_integrado",
            )
        )
        batch_op.drop_constraint("ck_smartpos_intent_metodo", type_="check")
        batch_op.create_check_constraint("ck_smartpos_intent_metodo", _NEW_METHODS)
        batch_op.create_check_constraint("ck_smartpos_intent_captura", _CAPTURE_MODES)

    op.execute(
        "UPDATE smartpos_payment_intents "
        "SET captura = 'dinheiro_pendente' "
        "WHERE metodo = 'dinheiro'"
    )

    with op.batch_alter_table("smartpos_payment_intents") as batch_op:
        batch_op.alter_column("captura", server_default=None)


def downgrade() -> None:
    # Os métodos novos não têm representação distinta no schema antigo.
    op.execute(
        "UPDATE smartpos_payment_intents "
        "SET metodo = 'cartao' "
        "WHERE metodo IN ('debito', 'credito', 'voucher')"
    )

    with op.batch_alter_table("smartpos_payment_intents") as batch_op:
        batch_op.drop_constraint("ck_smartpos_intent_captura", type_="check")
        batch_op.drop_constraint("ck_smartpos_intent_metodo", type_="check")
        batch_op.create_check_constraint("ck_smartpos_intent_metodo", _OLD_METHODS)
        batch_op.drop_column("captura")
