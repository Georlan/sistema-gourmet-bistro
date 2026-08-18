"""add rls to print jobs and secondary tables

Revision ID: a1b2c3d4e5f6
Revises: 997233f4ca30
Create Date: 2026-07-21 22:36:00.000000

As tabelas de impressão foram introduzidas originalmente pelo bootstrap ORM da
aplicação e esta revisão passou a assumir que elas já existiam. Para que a
cadeia Alembic também seja capaz de construir um PostgreSQL vazio, esta revisão
cria somente o schema-base das duas tabelas quando elas ainda não existem.
Bancos já existentes não sofrem alteração estrutural nessa etapa.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = '997233f4ca30'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _ensure_print_tables(bind) -> None:
    inspector = sa.inspect(bind)

    if not inspector.has_table("print_jobs"):
        op.create_table(
            "print_jobs",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column(
                "restaurante_id",
                sa.Integer(),
                sa.ForeignKey("restaurantes.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("document_type", sa.String(), nullable=False),
            sa.Column("destination", sa.String(), nullable=False, server_default="COZINHA"),
            sa.Column("source_type", sa.String(), nullable=False),
            sa.Column("source_id", sa.String(), nullable=False),
            sa.Column("payload_text", sa.String(), nullable=False),
            sa.Column("status", sa.String(), nullable=False, server_default="pending"),
            sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("idempotency_key", sa.String(), nullable=False),
            sa.Column("agent_id", sa.String(), nullable=True),
            sa.Column("printer_name", sa.String(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("printed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_error", sa.String(), nullable=True),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "restaurante_id",
                "idempotency_key",
                name="uq_print_jobs_restaurante_idempotency",
            ),
        )
        op.create_index(
            "ix_print_jobs_restaurante_id",
            "print_jobs",
            ["restaurante_id"],
        )
        op.create_index("ix_print_jobs_status", "print_jobs", ["status"])
        op.create_index(
            "ix_print_jobs_idempotency_key",
            "print_jobs",
            ["idempotency_key"],
        )

    # Recria o inspector para enxergar DDL emitido acima na mesma revisão.
    inspector = sa.inspect(bind)
    if not inspector.has_table("print_agent_tokens"):
        op.create_table(
            "print_agent_tokens",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column(
                "restaurante_id",
                sa.Integer(),
                sa.ForeignKey("restaurantes.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("agent_id", sa.String(), nullable=False),
            sa.Column("token_hash", sa.String(), nullable=False),
            sa.Column("ativo", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "restaurante_id",
                "agent_id",
                name="uq_print_agent_tokens_restaurante_agent",
            ),
        )
        op.create_index(
            "ix_print_agent_tokens_restaurante_id",
            "print_agent_tokens",
            ["restaurante_id"],
        )


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    _ensure_print_tables(bind)

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
    inspector = sa.inspect(bind)
    existing = set(inspector.get_table_names())
    for table in tables:
        if table not in existing:
            continue
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
