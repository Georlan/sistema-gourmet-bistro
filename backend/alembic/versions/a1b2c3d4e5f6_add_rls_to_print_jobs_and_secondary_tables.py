"""add rls to print jobs and secondary tables

Revision ID: a1b2c3d4e5f6
Revises: 997233f4ca30
Create Date: 2026-07-21 22:36:00.000000

As tabelas de impressão nasceram historicamente via criação manual/ORM antes
de a cadeia Alembic assumir todo o schema. Em uma reconstrução limpa elas não
existiam neste ponto, embora migrations posteriores assumissem sua presença.
Esta migration preserva bancos legados e cria somente a forma-base histórica
quando necessário; migrations posteriores continuam evoluindo essas tabelas.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, Sequence[str], None] = "997233f4ca30"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(bind, table_name: str) -> bool:
    return sa.inspect(bind).has_table(table_name)


def _ensure_legacy_print_tables(bind) -> None:
    """Materializa apenas as colunas existentes antes das evoluções posteriores."""
    if not _has_table(bind, "print_jobs"):
        op.create_table(
            "print_jobs",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("restaurante_id", sa.Integer(), nullable=False),
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
            sa.ForeignKeyConstraint(
                ["restaurante_id"],
                ["restaurantes.id"],
                ondelete="CASCADE",
            ),
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
            unique=False,
        )
        op.create_index(
            "ix_print_jobs_status",
            "print_jobs",
            ["status"],
            unique=False,
        )
        op.create_index(
            "ix_print_jobs_idempotency_key",
            "print_jobs",
            ["idempotency_key"],
            unique=False,
        )

    if not _has_table(bind, "print_agent_tokens"):
        op.create_table(
            "print_agent_tokens",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("restaurante_id", sa.Integer(), nullable=False),
            sa.Column("agent_id", sa.String(), nullable=False),
            sa.Column("token_hash", sa.String(), nullable=False),
            sa.Column("ativo", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(
                ["restaurante_id"],
                ["restaurantes.id"],
                ondelete="CASCADE",
            ),
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
            unique=False,
        )


def _apply_tenant_rls(table: str) -> None:
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
    op.execute(f"""
        CREATE POLICY tenant_isolation ON {table}
        USING (restaurante_id = current_setting('app.current_restaurante_id', true)::int)
        WITH CHECK (restaurante_id = current_setting('app.current_restaurante_id', true)::int)
    """)


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    _ensure_legacy_print_tables(bind)

    for table in ("print_jobs", "print_agent_tokens"):
        _apply_tenant_rls(table)

    secondary_tables = [
        "caixa_movimentacoes",
        "config_fidelizacao",
        "configuracoes_ia",
        "grupo_modificadores",
        "historico_fidelidade",
        "item_modificadores",
        "lancamentos",
        "mensagens_whatsapp",
        "motoboys",
        "observacoes_predefinidas",
        "opcao_modificadores",
        "produto_grupo_modificadores",
        "rascunhos_pedidos",
    ]
    for table in secondary_tables:
        # Algumas tabelas secundárias também surgiram em migrations posteriores.
        # Elas devem receber a política na migration que efetivamente as cria.
        if not _has_table(bind, table):
            continue
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
        _apply_tenant_rls(table)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    tables = [
        "print_jobs",
        "print_agent_tokens",
        "caixa_movimentacoes",
        "config_fidelizacao",
        "configuracoes_ia",
        "grupo_modificadores",
        "historico_fidelidade",
        "item_modificadores",
        "lancamentos",
        "mensagens_whatsapp",
        "motoboys",
        "observacoes_predefinidas",
        "opcao_modificadores",
        "produto_grupo_modificadores",
        "rascunhos_pedidos",
    ]
    for table in tables:
        if not _has_table(bind, table):
            continue
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
