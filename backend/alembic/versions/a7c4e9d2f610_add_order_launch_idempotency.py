"""add order launch idempotency

Revision ID: a7c4e9d2f610
Revises: d5b9f3a7c024
Create Date: 2026-08-20

Retries after a slow or lost response must not duplicate table items or their
automatic print job. The key is tenant-scoped so different restaurants may
use the same client-generated value safely.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a7c4e9d2f610"
down_revision: Union[str, Sequence[str], None] = "d5b9f3a7c024"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("lancamentos") as batch_op:
        batch_op.add_column(sa.Column("idempotency_key", sa.String(128), nullable=True))
        batch_op.create_index(
            "ix_lancamentos_idempotency_key",
            ["idempotency_key"],
            unique=False,
        )
        batch_op.create_unique_constraint(
            "uq_lancamentos_restaurante_idempotency",
            ["restaurante_id", "idempotency_key"],
        )
        batch_op.create_check_constraint(
            "ck_lancamentos_idempotency_nonblank",
            "idempotency_key IS NULL OR trim(idempotency_key) <> ''",
        )


def downgrade() -> None:
    with op.batch_alter_table("lancamentos") as batch_op:
        batch_op.drop_constraint(
            "ck_lancamentos_idempotency_nonblank",
            type_="check",
        )
        batch_op.drop_constraint(
            "uq_lancamentos_restaurante_idempotency",
            type_="unique",
        )
        batch_op.drop_index("ix_lancamentos_idempotency_key")
        batch_op.drop_column("idempotency_key")
