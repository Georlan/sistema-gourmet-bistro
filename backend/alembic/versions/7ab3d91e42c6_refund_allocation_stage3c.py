"""add refund execution and allocation ledgers for stage 3C

Revision ID: 7ab3d91e42c6
Revises: 3f91a8c7d2e4
Create Date: 2026-08-16 11:58:00.000000

Preserva duas dimensões que não podem ser confundidas:
- de qual Conta/comanda saiu a parcela estornada;
- por qual meio o dinheiro foi efetivamente devolvido ao cliente.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "7ab3d91e42c6"
down_revision: Union[str, Sequence[str], None] = "3f91a8c7d2e4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TENANT_TABLES = (
    "pagamento_estorno_liquidacoes",
    "pagamento_estorno_alocacoes",
)


def _enable_rls() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    for table in TENANT_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table} "
            "USING (restaurante_id = current_setting('app.current_restaurante_id', true)::int) "
            "WITH CHECK (restaurante_id = current_setting('app.current_restaurante_id', true)::int)"
        )
        op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE {table} TO koma_app")
    op.execute(
        "GRANT USAGE, SELECT ON SEQUENCE pagamento_estorno_liquidacoes_id_seq TO koma_app"
    )
    op.execute(
        "GRANT USAGE, SELECT ON SEQUENCE pagamento_estorno_alocacoes_id_seq TO koma_app"
    )


def upgrade() -> None:
    op.create_table(
        "pagamento_estorno_liquidacoes",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("restaurante_id", sa.Integer(), nullable=False),
        sa.Column("estorno_id", sa.String(), nullable=False),
        sa.Column("turno_id", sa.Integer(), nullable=False),
        sa.Column("metodo_devolucao", sa.String(length=20), nullable=False),
        sa.Column("criado_em", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["restaurante_id"], ["restaurantes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["estorno_id"], ["pagamento_estornos.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["turno_id"], ["caixa_turnos.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint(
            "restaurante_id",
            "estorno_id",
            name="uq_pagamento_estorno_liquidacao_estorno",
        ),
        sa.CheckConstraint(
            "metodo_devolucao IN ('dinheiro', 'pix', 'cartao', 'cartao_debito', 'cartao_credito')",
            name="ck_pagamento_estorno_liquidacao_metodo",
        ),
    )
    for column in ("restaurante_id", "estorno_id", "turno_id"):
        op.create_index(
            f"ix_pagamento_estorno_liquidacoes_{column}",
            "pagamento_estorno_liquidacoes",
            [column],
        )
    op.create_index(
        "ix_pagamento_estorno_liquidacoes_tenant_turno",
        "pagamento_estorno_liquidacoes",
        ["restaurante_id", "turno_id"],
    )

    op.create_table(
        "pagamento_estorno_alocacoes",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("restaurante_id", sa.Integer(), nullable=False),
        sa.Column("estorno_id", sa.String(), nullable=False),
        sa.Column("pagamento_id", sa.String(), nullable=False),
        sa.Column("pagamento_alocacao_id", sa.Integer(), nullable=True),
        sa.Column("comanda_id", sa.String(), nullable=False),
        sa.Column("atendimento_id", sa.String(), nullable=True),
        sa.Column("valor", sa.Numeric(14, 2), nullable=False),
        sa.Column("criado_em", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["restaurante_id"], ["restaurantes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["estorno_id"], ["pagamento_estornos.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["pagamento_id"], ["pagamentos.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["pagamento_alocacao_id"], ["pagamento_alocacoes.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["comanda_id"], ["comandas.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["atendimento_id"], ["atendimentos_mesa.id"], ondelete="SET NULL"),
        sa.UniqueConstraint(
            "restaurante_id",
            "estorno_id",
            "comanda_id",
            name="uq_pagamento_estorno_alocacao_comanda",
        ),
        sa.CheckConstraint(
            "valor > 0",
            name="ck_pagamento_estorno_alocacao_valor_positive",
        ),
    )
    for column in (
        "restaurante_id",
        "estorno_id",
        "pagamento_id",
        "pagamento_alocacao_id",
        "comanda_id",
        "atendimento_id",
    ):
        op.create_index(
            f"ix_pagamento_estorno_alocacoes_{column}",
            "pagamento_estorno_alocacoes",
            [column],
        )
    op.create_index(
        "ix_pagamento_estorno_alocacoes_tenant_estorno",
        "pagamento_estorno_alocacoes",
        ["restaurante_id", "estorno_id"],
    )
    op.create_index(
        "ix_pagamento_estorno_alocacoes_tenant_pagamento",
        "pagamento_estorno_alocacoes",
        ["restaurante_id", "pagamento_id"],
    )
    op.create_index(
        "ix_pagamento_estorno_alocacoes_tenant_atendimento",
        "pagamento_estorno_alocacoes",
        ["restaurante_id", "atendimento_id"],
    )

    # Estornos criados no checkpoint 3A não possuíam dimensão separada de
    # liquidação; neles a devolução era implicitamente feita no mesmo meio da
    # venda. Materializamos essa semântica para manter o histórico consistente.
    op.execute("""
        INSERT INTO pagamento_estorno_liquidacoes (
            restaurante_id,
            estorno_id,
            turno_id,
            metodo_devolucao,
            criado_em
        )
        SELECT
            e.restaurante_id,
            e.id,
            e.turno_id,
            e.metodo,
            e.criado_em
        FROM pagamento_estornos AS e
    """)

    _enable_rls()


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        for table in reversed(TENANT_TABLES):
            op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
            op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
            op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
    op.drop_table("pagamento_estorno_alocacoes")
    op.drop_table("pagamento_estorno_liquidacoes")
