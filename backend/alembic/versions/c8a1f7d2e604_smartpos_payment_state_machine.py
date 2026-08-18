"""add SmartPOS payment intent state machine

Revision ID: c8a1f7d2e604
Revises: b7d3f1a8c902
Create Date: 2026-08-18
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c8a1f7d2e604"
down_revision: Union[str, Sequence[str], None] = "b7d3f1a8c902"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_NEW_STATUSES = (
    "status IN ('criada', 'pendente', 'processando', 'aprovada', "
    "'recusada', 'cancelada', 'expirada')"
)
_OLD_STATUSES = "status IN ('criada', 'cancelada', 'expirada')"
_EVENT_STATUSES = (
    "IN ('criada', 'pendente', 'processando', 'aprovada', "
    "'recusada', 'cancelada', 'expirada')"
)


def upgrade() -> None:
    with op.batch_alter_table("smartpos_payment_intents") as batch_op:
        batch_op.add_column(
            sa.Column(
                "status_em",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            )
        )
        batch_op.drop_constraint("ck_smartpos_intent_status", type_="check")
        batch_op.create_check_constraint("ck_smartpos_intent_status", _NEW_STATUSES)

    op.execute(
        "UPDATE smartpos_payment_intents SET status_em = criado_em WHERE criado_em IS NOT NULL"
    )
    op.execute(
        "UPDATE smartpos_payment_intents SET status = 'pendente' "
        "WHERE status = 'criada' AND captura IN ('dinheiro_pendente', 'registro_externo')"
    )

    with op.batch_alter_table("smartpos_payment_intents") as batch_op:
        batch_op.alter_column("status_em", server_default=None)

    op.create_table(
        "smartpos_payment_intent_events",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("restaurante_id", sa.Integer(), nullable=False),
        sa.Column("intent_id", sa.String(length=36), nullable=False),
        sa.Column("from_status", sa.String(length=24), nullable=False),
        sa.Column("to_status", sa.String(length=24), nullable=False),
        sa.Column("actor_id", sa.String(), nullable=True),
        sa.Column("transition_key", sa.String(length=128), nullable=False),
        sa.Column("motivo", sa.String(length=255), nullable=True),
        sa.Column("criado_em", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            f"from_status {_EVENT_STATUSES}",
            name="ck_smartpos_event_from_status",
        ),
        sa.CheckConstraint(
            f"to_status {_EVENT_STATUSES}",
            name="ck_smartpos_event_to_status",
        ),
        sa.ForeignKeyConstraint(
            ["intent_id"],
            ["smartpos_payment_intents.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["restaurante_id"],
            ["restaurantes.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "restaurante_id",
            "intent_id",
            "transition_key",
            name="uq_smartpos_intent_event_transition_key",
        ),
    )
    op.create_index(
        "ix_smartpos_event_tenant_intent",
        "smartpos_payment_intent_events",
        ["restaurante_id", "intent_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_smartpos_event_tenant_intent",
        table_name="smartpos_payment_intent_events",
    )
    op.drop_table("smartpos_payment_intent_events")

    op.execute(
        "UPDATE smartpos_payment_intents SET status = 'criada' "
        "WHERE status IN ('pendente', 'processando', 'aprovada', 'recusada')"
    )

    with op.batch_alter_table("smartpos_payment_intents") as batch_op:
        batch_op.drop_constraint("ck_smartpos_intent_status", type_="check")
        batch_op.create_check_constraint("ck_smartpos_intent_status", _OLD_STATUSES)
        batch_op.drop_column("status_em")
