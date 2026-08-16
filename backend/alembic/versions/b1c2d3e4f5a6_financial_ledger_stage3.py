"""add financial allocation and refund ledger

Revision ID: b1c2d3e4f5a6
Revises: a0b1c2d3e4f5
Create Date: 2026-08-16 10:55:00.000000

Preserva Pagamento como evento imutável de recebimento e adiciona:
- alocação do valor entre comandas/famílias financeiras;
- estornos como eventos próprios, sem apagar a venda original.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b1c2d3e4f5a6"
down_revision: Union[str, Sequence[str], None] = "a0b1c2d3e4f5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TENANT_TABLES = ("pagamento_alocacoes", "pagamento_estornos")


def _enable_tenant_rls() -> None:
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
        op.execute(
            f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE {table} TO koma_app"
        )

    op.execute(
        "GRANT USAGE, SELECT ON SEQUENCE pagamento_alocacoes_id_seq TO koma_app"
    )


def upgrade() -> None:
    op.create_table(
        "pagamento_alocacoes",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("restaurante_id", sa.Integer(), nullable=False),
        sa.Column("pagamento_id", sa.String(), nullable=False),
        sa.Column("comanda_id", sa.String(), nullable=False),
        sa.Column("atendimento_id", sa.String(), nullable=True),
        sa.Column("valor", sa.Numeric(14, 2), nullable=False),
        sa.Column("criado_em", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["restaurante_id"], ["restaurantes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["pagamento_id"], ["pagamentos.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["comanda_id"], ["comandas.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["atendimento_id"], ["atendimentos_mesa.id"], ondelete="SET NULL"),
        sa.UniqueConstraint(
            "restaurante_id",
            "pagamento_id",
            "comanda_id",
            name="uq_pagamento_alocacao_comanda",
        ),
        sa.CheckConstraint("valor > 0", name="ck_pagamento_alocacao_valor_positive"),
    )
    op.create_index(
        "ix_pagamento_alocacoes_restaurante_id",
        "pagamento_alocacoes",
        ["restaurante_id"],
    )
    op.create_index(
        "ix_pagamento_alocacoes_pagamento_id",
        "pagamento_alocacoes",
        ["pagamento_id"],
    )
    op.create_index(
        "ix_pagamento_alocacoes_comanda_id",
        "pagamento_alocacoes",
        ["comanda_id"],
    )
    op.create_index(
        "ix_pagamento_alocacoes_atendimento_id",
        "pagamento_alocacoes",
        ["atendimento_id"],
    )
    op.create_index(
        "ix_pagamento_alocacoes_tenant_pagamento",
        "pagamento_alocacoes",
        ["restaurante_id", "pagamento_id"],
    )
    op.create_index(
        "ix_pagamento_alocacoes_tenant_atendimento",
        "pagamento_alocacoes",
        ["restaurante_id", "atendimento_id"],
    )

    op.create_table(
        "pagamento_estornos",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("restaurante_id", sa.Integer(), nullable=False),
        sa.Column("pagamento_id", sa.String(), nullable=False),
        sa.Column("turno_id", sa.Integer(), nullable=False),
        sa.Column("usuario_id", sa.String(), nullable=True),
        sa.Column("valor", sa.Numeric(14, 2), nullable=False),
        sa.Column("metodo", sa.String(length=20), nullable=False),
        sa.Column("motivo", sa.Text(), nullable=False),
        sa.Column("idempotency_key", sa.String(), nullable=False),
        sa.Column("criado_em", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["restaurante_id"], ["restaurantes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["pagamento_id"], ["pagamentos.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["turno_id"], ["caixa_turnos.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["usuario_id"], ["usuarios.id"], ondelete="SET NULL"),
        sa.UniqueConstraint(
            "restaurante_id",
            "idempotency_key",
            name="uq_pagamento_estorno_idempotency",
        ),
        sa.CheckConstraint("valor > 0", name="ck_pagamento_estorno_valor_positive"),
        sa.CheckConstraint(
            "metodo IN ('dinheiro', 'pix', 'cartao', 'cartao_debito', 'cartao_credito')",
            name="ck_pagamento_estorno_metodo",
        ),
    )
    op.create_index(
        "ix_pagamento_estornos_restaurante_id",
        "pagamento_estornos",
        ["restaurante_id"],
    )
    op.create_index(
        "ix_pagamento_estornos_pagamento_id",
        "pagamento_estornos",
        ["pagamento_id"],
    )
    op.create_index(
        "ix_pagamento_estornos_turno_id",
        "pagamento_estornos",
        ["turno_id"],
    )
    op.create_index(
        "ix_pagamento_estornos_tenant_pagamento",
        "pagamento_estornos",
        ["restaurante_id", "pagamento_id"],
    )
    op.create_index(
        "ix_pagamento_estornos_tenant_turno_created",
        "pagamento_estornos",
        ["restaurante_id", "turno_id", "criado_em"],
    )

    # Compatibilidade: pagamentos históricos recebem uma alocação integral na
    # própria comanda. Se a família de Atendimento já foi materializada, ela é
    # preservada; delivery/retirada permanecem com atendimento_id nulo.
    op.execute("""
        INSERT INTO pagamento_alocacoes (
            restaurante_id,
            pagamento_id,
            comanda_id,
            atendimento_id,
            valor,
            criado_em
        )
        SELECT
            p.restaurante_id,
            p.id,
            p.comanda_id,
            ac.atendimento_id,
            p.valor,
            p.criado_em
        FROM pagamentos AS p
        LEFT JOIN atendimento_comandas AS ac
          ON ac.restaurante_id = p.restaurante_id
         AND ac.comanda_id = p.comanda_id
        WHERE p.comanda_id IS NOT NULL
    """)

    _enable_tenant_rls()


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        for table in reversed(TENANT_TABLES):
            op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
            op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
            op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")

    op.drop_table("pagamento_estornos")
    op.drop_table("pagamento_alocacoes")
