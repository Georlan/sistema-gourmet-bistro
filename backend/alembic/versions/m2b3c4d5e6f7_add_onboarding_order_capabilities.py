"""Persist explicit onboarding order capabilities.

Revision ID: m2b3c4d5e6f7
Revises: l1a2b3c4d5e6
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "m2b3c4d5e6f7"
down_revision: Union[str, Sequence[str], None] = "l1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "configuracoes_restaurante",
        sa.Column("tipos_pedido_ativos", sa.JSON(), nullable=True),
    )

    # Tenants que já existiam antes deste onboarding não podem voltar a ficar
    # bloqueados por uma seleção que nunca tiveram oportunidade de confirmar.
    # A capability neutra de retirada satisfaz apenas o novo passo de onboarding
    # e NÃO altera delivery_ativo, mapa de mesas ou qualquer comportamento runtime.
    # Quando o responsável revisar/salvar o novo passo, a seleção passa a refletir
    # explicitamente a operação real do restaurante.
    table = sa.table(
        "configuracoes_restaurante",
        sa.column("tipos_pedido_ativos", sa.JSON()),
    )
    op.get_bind().execute(
        table.update().values(tipos_pedido_ativos=["retirada"])
    )


def downgrade() -> None:
    op.drop_column("configuracoes_restaurante", "tipos_pedido_ativos")
