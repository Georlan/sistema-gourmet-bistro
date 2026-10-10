"""indexes for complements consumption report (order entry window + item modifiers)

Revision ID: b4c5d6e7f8a9
Revises: a3af4de4e221
Create Date: 2026-10-06

Somente aditivo: acelera a janela por entrada (lancamentos) e o join item → seleções.
"""
from alembic import op

revision = "b4c5d6e7f8a9"
down_revision = "a3af4de4e221"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.create_index("ix_lancamentos_tenant_timestamp", "lancamentos", ["restaurante_id", "timestamp"], if_not_exists=True)
    op.create_index("ix_item_modificadores_tenant_item", "item_modificadores", ["restaurante_id", "item_id"], if_not_exists=True)


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.drop_index("ix_item_modificadores_tenant_item", table_name="item_modificadores", if_exists=True)
    op.drop_index("ix_lancamentos_tenant_timestamp", table_name="lancamentos", if_exists=True)
