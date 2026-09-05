"""converge monetary and invitation schema

Revision ID: 910241c0a2ab
Revises: 8c9d0e1f2a3b
Create Date: 2026-09-05 01:09:34.065692

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '910241c0a2ab'
down_revision: Union[str, Sequence[str], None] = '8c9d0e1f2a3b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


MONEY_COLUMNS = {
    "configuracoes_restaurante": ("pedido_minimo", "frete_gratis_valor"),
    "cupons": ("valor_desconto", "valor_minimo_pedido"),
    "comandas": ("valor_desconto_cupom", "valor_desconto_cashback", "delivery_troco_para"),
}


def upgrade() -> None:
    # PostgreSQL runs this migration transactionally. An overflow aborts it;
    # do not silently clamp values or alter any historical migration.
    postgres = op.get_bind().dialect.name == "postgresql"
    for table, columns in MONEY_COLUMNS.items():
        with op.batch_alter_table(table) as batch:
            for column in columns:
                options = {"postgresql_using": f'round("{column}"::numeric, 2)'} if postgres else {}
                batch.alter_column(column, existing_type=sa.Float(), type_=sa.Numeric(14, 2), **options)
    with op.batch_alter_table("usuarios") as batch:
        batch.alter_column("senha_hash", existing_type=sa.String(), nullable=True)


def downgrade() -> None:
    # Invitation nullability is intentionally retained: reverting it would
    # reject legitimate pending invitations created after this migration.
    for table, columns in MONEY_COLUMNS.items():
        with op.batch_alter_table(table) as batch:
            for column in columns:
                batch.alter_column(column, existing_type=sa.Numeric(14, 2), type_=sa.Float())
