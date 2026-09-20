"""Persist backend auto-accept and pickup-to-dine-in conversion audit.

Revision ID: o4d5e6f7a8b9
Revises: n3c4d5e6f7a8
Create Date: 2026-09-20
"""

from alembic import op
import sqlalchemy as sa


revision = "o4d5e6f7a8b9"
down_revision = "n3c4d5e6f7a8"
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
    bind = op.get_bind()
    converted = bind.execute(
        sa.text(
            "SELECT 1 FROM movimentos_atendimento "
            "WHERE tipo = 'conversao_modalidade' LIMIT 1"
        )
    ).first()
    if converted is not None:
        raise RuntimeError(
            "Downgrade bloqueado: existem movimentos 'conversao_modalidade'. "
            "Preserve o histórico de auditoria ou migre esses dados explicitamente."
        )

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
