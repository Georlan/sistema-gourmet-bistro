"""add rls to print jobs and secondary tables

Revision ID: a1b2c3d4e5f6
Revises: 997233f4ca30
Create Date: 2026-07-21 22:36:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = '997233f4ca30'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    # 1. Tabelas de Impressão em Nuvem
    print_tables = ["print_jobs", "print_agent_tokens"]
    for table in print_tables:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
        op.execute(f"""
            CREATE POLICY tenant_isolation ON {table}
            USING (restaurante_id = current_setting('app.current_restaurante_id', true)::int)
            WITH CHECK (restaurante_id = current_setting('app.current_restaurante_id', true)::int)
        """)

    # 2. Tabelas secundárias com WITH CHECK explícito
    secondary_tables = [
        "caixa_movimentacoes", "config_fidelizacao", "configuracoes_ia",
        "grupo_modificadores", "historico_fidelidade", "item_modificadores",
        "lancamentos", "mensagens_whatsapp", "motoboys",
        "observacoes_predefinidas", "opcao_modificadores",
        "produto_grupo_modificadores", "rascunhos_pedidos"
    ]
    for table in secondary_tables:
        columns = {column["name"] for column in sa.inspect(bind).get_columns(table)}
        if "restaurante_id" not in columns:
            op.add_column(
                table,
                sa.Column("restaurante_id", sa.Integer(), nullable=True),
            )
            op.create_foreign_key(
                f"fk_{table}_restaurante_id",
                table,
                "restaurantes",
                ["restaurante_id"],
                ["id"],
            )
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
        op.execute(f"""
            CREATE POLICY tenant_isolation ON {table}
            USING (restaurante_id = current_setting('app.current_restaurante_id', true)::int)
            WITH CHECK (restaurante_id = current_setting('app.current_restaurante_id', true)::int)
        """)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    tables = [
        "print_jobs", "print_agent_tokens",
        "caixa_movimentacoes", "config_fidelizacao", "configuracoes_ia",
        "grupo_modificadores", "historico_fidelidade", "item_modificadores",
        "lancamentos", "mensagens_whatsapp", "motoboys",
        "observacoes_predefinidas", "opcao_modificadores",
        "produto_grupo_modificadores", "rascunhos_pedidos"
    ]
    for table in tables:
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
