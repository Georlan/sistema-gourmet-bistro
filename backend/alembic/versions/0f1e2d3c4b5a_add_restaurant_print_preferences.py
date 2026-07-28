"""add restaurant print preferences

Revision ID: 0f1e2d3c4b5a
Revises: fd136dcefa5c
Create Date: 2026-07-28 16:40:00

Persists receipt/production branding per tenant so every workstation and the
automatic print path use the same configuration.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0f1e2d3c4b5a"
down_revision: Union[str, Sequence[str], None] = "fd136dcefa5c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    op.execute("SET LOCAL lock_timeout = '5s'")
    op.add_column(
        "configuracoes_restaurante",
        sa.Column(
            "impressao_nome_restaurante",
            sa.String(length=80),
            nullable=True,
        ),
    )
    op.add_column(
        "configuracoes_restaurante",
        sa.Column(
            "impressao_nome_posicao",
            sa.String(length=20),
            nullable=False,
            server_default="cabecalho",
        ),
    )
    op.add_column(
        "configuracoes_restaurante",
        sa.Column(
            "impressao_mensagem_rodape",
            sa.String(length=160),
            nullable=True,
        ),
    )
    op.add_column(
        "configuracoes_restaurante",
        sa.Column(
            "impressao_mostrar_descricao",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )

    # Existing tenants start with their own registered name, not Kôma's demo
    # branding. The field remains nullable so the API can safely fall back to
    # restaurantes.nome for newly provisioned configurations.
    op.execute(
        """
        UPDATE public.configuracoes_restaurante AS configuracao
        SET impressao_nome_restaurante = restaurante.nome
        FROM public.restaurantes AS restaurante
        WHERE restaurante.id = configuracao.restaurante_id
          AND configuracao.impressao_nome_restaurante IS NULL
        """
    )
    op.create_check_constraint(
        "ck_config_restaurante_impressao_nome_posicao",
        "configuracoes_restaurante",
        "impressao_nome_posicao IN ('cabecalho', 'rodape', 'oculto')",
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    op.drop_constraint(
        "ck_config_restaurante_impressao_nome_posicao",
        "configuracoes_restaurante",
        type_="check",
    )
    op.drop_column(
        "configuracoes_restaurante",
        "impressao_mostrar_descricao",
    )
    op.drop_column(
        "configuracoes_restaurante",
        "impressao_mensagem_rodape",
    )
    op.drop_column(
        "configuracoes_restaurante",
        "impressao_nome_posicao",
    )
    op.drop_column(
        "configuracoes_restaurante",
        "impressao_nome_restaurante",
    )
