"""force RLS on SmartPOS tenant tables

Revision ID: c8f4a1d2e3b4
Revises: a6c2e9f4b8d1
Create Date: 2026-08-18

As tabelas SmartPOS foram criadas depois do hardening global que aplicava
FORCE ROW LEVEL SECURITY nas tabelas tenant existentes. Esta migration fecha
essa janela também nos bancos já migrados em produção.
"""

from typing import Sequence, Union

from alembic import op


revision: str = "c8f4a1d2e3b4"
down_revision: Union[str, Sequence[str], None] = "a6c2e9f4b8d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_TABLES = (
    "restaurante_capabilities",
    "smartpos_payment_intents",
)


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    for table in _TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    for table in _TABLES:
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
