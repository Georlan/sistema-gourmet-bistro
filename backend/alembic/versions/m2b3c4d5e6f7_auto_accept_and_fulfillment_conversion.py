"""Persist online auto-accept and audit pickup-to-dine-in conversion.

Revision ID: m2b3c4d5e6f7
Revises: l1a2b3c4d5e6
Create Date: 2026-09-20
"""

from alembic import op
import sqlalchemy as sa


revision = "m2b3c4d5e6f7"
down_revision = "l1a2b3c4d5e6"
branch_labels = None
depends_on = None


_MOVEMENT_CHECK = (
    "tipo IN ('abertura', 'transferencia', 'mesclagem', 'desmesclagem', "
    "'transferencia_item', 'fechamento', 'reabertura', 'promocao_principal', "
    "'conversao_modalidade')"
)

_LEGACY_MOVEMENT_CHECK = (
    "tipo IN ('abertura', 'transferencia', 'mesclagem', 'desmesclagem', "
    "'transferencia_item', 'fechamento', 'reabertura', 'promocao_principal')"
)


def upgrade() -> None:
    op.add_column(
        "online_order_controls",
        sa.Column(
            "auto_accept",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.alter_column("online_order_controls", "auto_accept", server_default=None)

    op.drop_constraint(
        "ck_movimento_atendimento_tipo",
        "movimentos_atendimento",
        type_="check",
    )
    op.create_check_constraint(
        "ck_movimento_atendimento_tipo",
        "movimentos_atendimento",
        _MOVEMENT_CHECK,
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_movimento_atendimento_tipo",
        "movimentos_atendimento",
        type_="check",
    )
    op.create_check_constraint(
        "ck_movimento_atendimento_tipo",
        "movimentos_atendimento",
        _LEGACY_MOVEMENT_CHECK,
    )
    op.drop_column("online_order_controls", "auto_accept")
