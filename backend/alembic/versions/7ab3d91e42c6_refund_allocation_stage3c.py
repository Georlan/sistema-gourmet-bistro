"""add refund allocation ledger for stage 3C

Revision ID: 7ab3d91e42c6
Revises: 3f91a8c7d2e4
Create Date: 2026-08-16 11:58:00.000000

Preserva a origem exata de estornos quando um Pagamento foi distribuído entre
mais de uma comanda/Conta, sem inventar rateios em estornos parciais.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "7ab3d91e42c6"
down_revision: Union[str, Sequence[str], None] = "3f91a8c7d2e4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TABLE = "pagamento_estorno_alocacoes"


def _enable_rls() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    op.execute(f"ALTER TABLE {TABLE} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {TABLE} FORCE ROW LEVEL SECURITY")
    op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {TABLE}")
    op.execute(
        f"CREATE POLICY tenant_isolation ON {TABLE} "
        "USING (restaurante_id = current_setting('app.current_restaurante_id', true)::int) "
        "WITH CHECK (restaurante_id = current_setting('app.current_restaurante_id', true)::int)"
    )
    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE {TABLE} TO koma_app")
    op.execute(
        "GRANT USAGE, SELECT ON SEQUENCE pagamento_estorno_alocacoes_id_seq TO koma_app"
    )


def upgrade() -> None:
    op.create_table(
        TABLE,
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
            f"ix_{TABLE}_{column}",
            TABLE,
            [column],
        )
    op.create_index(
        "ix_pagamento_estorno_alocacoes_tenant_estorno",
        TABLE,
        ["restaurante_id", "estorno_id"],
    )
    op.create_index(
        "ix_pagamento_estorno_alocacoes_tenant_pagamento",
        TABLE,
        ["restaurante_id", "pagamento_id"],
    )
    op.create_index(
        "ix_pagamento_estorno_alocacoes_tenant_atendimento",
        TABLE,
        ["restaurante_id", "atendimento_id"],
    )
    _enable_rls()


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {TABLE}")
        op.execute(f"ALTER TABLE {TABLE} NO FORCE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {TABLE} DISABLE ROW LEVEL SECURITY")
    op.drop_table(TABLE)
