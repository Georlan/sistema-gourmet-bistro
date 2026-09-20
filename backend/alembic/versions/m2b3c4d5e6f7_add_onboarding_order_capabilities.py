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
    # bloqueados por uma escolha que nunca tiveram oportunidade de confirmar.
    # Preservamos o comportamento legado: consumo local + retirada sempre
    # disponíveis e delivery somente quando já estava habilitado.
    bind = op.get_bind()
    table = sa.table(
        "configuracoes_restaurante",
        sa.column("id", sa.Integer()),
        sa.column("delivery_ativo", sa.Boolean()),
        sa.column("tipos_pedido_ativos", sa.JSON()),
    )
    rows = bind.execute(
        sa.select(table.c.id, table.c.delivery_ativo)
    ).mappings().all()
    for row in rows:
        order_types = ["consumo_local", "retirada"]
        if row["delivery_ativo"] is not False:
            order_types.append("delivery")
        bind.execute(
            table.update()
            .where(table.c.id == row["id"])
            .values(tipos_pedido_ativos=order_types)
        )


def downgrade() -> None:
    op.drop_column("configuracoes_restaurante", "tipos_pedido_ativos")
