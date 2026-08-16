"""add operational table-service identity

Revision ID: f9a0b1c2d3e4
Revises: e8f9a0b1c2d3
Create Date: 2026-08-16 01:25:00.000000

Cria uma identidade estável para a conta de mesa e uma identidade humana por
lançamento (46-A, 46-B...). O vínculo é aditivo: tabelas legadas permanecem
compatíveis e são materializadas sob demanda.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f9a0b1c2d3e4"
down_revision: Union[str, Sequence[str], None] = "e8f9a0b1c2d3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "numeradores_operacionais",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("restaurante_id", sa.Integer(), nullable=False),
        sa.Column("periodo_ref", sa.String(length=7), nullable=False),
        sa.Column("ultimo_numero", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("atualizado_em", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["restaurante_id"], ["restaurantes.id"], ondelete="CASCADE"),
        sa.UniqueConstraint(
            "restaurante_id", "periodo_ref", name="uq_numerador_operacional_periodo"
        ),
    )
    op.create_index(
        "ix_numeradores_operacionais_restaurante_id",
        "numeradores_operacionais",
        ["restaurante_id"],
    )

    op.create_table(
        "atendimentos_mesa",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("restaurante_id", sa.Integer(), nullable=False),
        sa.Column("numero_conta", sa.Integer(), nullable=False),
        sa.Column("periodo_ref", sa.String(length=7), nullable=False),
        sa.Column("mesa_id", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="aberto"),
        sa.Column("principal_id", sa.String(), nullable=True),
        sa.Column("proxima_sequencia", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("criado_em", sa.DateTime(), nullable=False),
        sa.Column("fechado_em", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["restaurante_id"], ["restaurantes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["principal_id"], ["atendimentos_mesa.id"], ondelete="SET NULL"),
        sa.UniqueConstraint(
            "restaurante_id", "periodo_ref", "numero_conta", name="uq_atendimento_conta_periodo"
        ),
        sa.CheckConstraint("status IN ('aberto', 'fechado')", name="ck_atendimento_status"),
        sa.CheckConstraint("proxima_sequencia >= 1", name="ck_atendimento_proxima_sequencia"),
    )
    op.create_index("ix_atendimentos_mesa_restaurante_id", "atendimentos_mesa", ["restaurante_id"])
    op.create_index("ix_atendimentos_mesa_mesa_id", "atendimentos_mesa", ["mesa_id"])
    op.create_index("ix_atendimentos_mesa_status", "atendimentos_mesa", ["status"])
    op.create_index("ix_atendimentos_mesa_principal_id", "atendimentos_mesa", ["principal_id"])

    op.create_table(
        "atendimento_comandas",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("restaurante_id", sa.Integer(), nullable=False),
        sa.Column("atendimento_id", sa.String(), nullable=False),
        sa.Column("comanda_id", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["restaurante_id"], ["restaurantes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["atendimento_id"], ["atendimentos_mesa.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["comanda_id"], ["comandas.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("restaurante_id", "comanda_id", name="uq_atendimento_comanda"),
    )
    op.create_index("ix_atendimento_comandas_restaurante_id", "atendimento_comandas", ["restaurante_id"])
    op.create_index("ix_atendimento_comandas_comanda_id", "atendimento_comandas", ["comanda_id"])
    op.create_index(
        "ix_atendimento_comandas_atendimento",
        "atendimento_comandas",
        ["restaurante_id", "atendimento_id"],
    )

    op.create_table(
        "lancamento_identidades",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("restaurante_id", sa.Integer(), nullable=False),
        sa.Column("atendimento_id", sa.String(), nullable=False),
        sa.Column("lancamento_id", sa.String(), nullable=False),
        sa.Column("sequencia", sa.Integer(), nullable=False),
        sa.Column("criado_em", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["restaurante_id"], ["restaurantes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["atendimento_id"], ["atendimentos_mesa.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["lancamento_id"], ["lancamentos.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("restaurante_id", "lancamento_id", name="uq_lancamento_identidade"),
        sa.UniqueConstraint(
            "restaurante_id", "atendimento_id", "sequencia", name="uq_lancamento_sequencia_atendimento"
        ),
        sa.CheckConstraint("sequencia >= 1", name="ck_lancamento_sequencia_positive"),
    )
    op.create_index("ix_lancamento_identidades_restaurante_id", "lancamento_identidades", ["restaurante_id"])
    op.create_index("ix_lancamento_identidades_atendimento_id", "lancamento_identidades", ["atendimento_id"])
    op.create_index("ix_lancamento_identidades_lancamento_id", "lancamento_identidades", ["lancamento_id"])

    op.create_table(
        "movimentos_atendimento",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("restaurante_id", sa.Integer(), nullable=False),
        sa.Column("atendimento_id", sa.String(), nullable=False),
        sa.Column("tipo", sa.String(length=32), nullable=False),
        sa.Column("mesa_origem_id", sa.Integer(), nullable=True),
        sa.Column("mesa_destino_id", sa.Integer(), nullable=True),
        sa.Column("ator_id", sa.String(), nullable=True),
        sa.Column("detalhes", sa.JSON(), nullable=True),
        sa.Column("criado_em", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["restaurante_id"], ["restaurantes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["atendimento_id"], ["atendimentos_mesa.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["ator_id"], ["usuarios.id"], ondelete="SET NULL"),
        sa.CheckConstraint(
            "tipo IN ('abertura', 'transferencia', 'mesclagem', 'desmesclagem', "
            "'transferencia_item', 'fechamento', 'reabertura', 'promocao_principal')",
            name="ck_movimento_atendimento_tipo",
        ),
    )
    op.create_index("ix_movimentos_atendimento_restaurante_id", "movimentos_atendimento", ["restaurante_id"])
    op.create_index("ix_movimentos_atendimento_atendimento_id", "movimentos_atendimento", ["atendimento_id"])
    op.create_index(
        "ix_movimento_atendimento_tenant_atendimento_created",
        "movimentos_atendimento",
        ["restaurante_id", "atendimento_id", "criado_em"],
    )

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(
            "CREATE INDEX ix_atendimento_tenant_open_mesa ON atendimentos_mesa "
            "(restaurante_id, mesa_id) WHERE status = 'aberto'"
        )
        for table in (
            "numeradores_operacionais",
            "atendimentos_mesa",
            "atendimento_comandas",
            "lancamento_identidades",
            "movimentos_atendimento",
        ):
            op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
            op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
            op.execute(
                f"CREATE POLICY tenant_isolation ON {table} "
                "USING (restaurante_id = current_setting('app.current_restaurante_id', true)::int) "
                "WITH CHECK (restaurante_id = current_setting('app.current_restaurante_id', true)::int)"
            )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        for table in (
            "movimentos_atendimento",
            "lancamento_identidades",
            "atendimento_comandas",
            "atendimentos_mesa",
            "numeradores_operacionais",
        ):
            op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
            op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
        op.execute("DROP INDEX IF EXISTS ix_atendimento_tenant_open_mesa")

    op.drop_table("movimentos_atendimento")
    op.drop_table("lancamento_identidades")
    op.drop_table("atendimento_comandas")
    op.drop_table("atendimentos_mesa")
    op.drop_table("numeradores_operacionais")
