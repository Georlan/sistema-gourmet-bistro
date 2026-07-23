"""enforce tenant columns on every business table

Revision ID: f7a8b9c0d1e2
Revises: e6f7a8b9c0d1
Create Date: 2026-07-23 01:10:00.000000

P0-02 follow-up:
* repairs legacy secondary rows whose restaurante_id was never populated;
* makes every tenant discriminator mandatory;
* keeps fresh SQLite/PostgreSQL migration chains reproducible.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f7a8b9c0d1e2"
down_revision: Union[str, Sequence[str], None] = "e6f7a8b9c0d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TENANT_TABLES = (
    "activity_logs",
    "caixa_movimentacoes",
    "caixa_turnos",
    "categorias",
    "clientes",
    "comandas",
    "config_fidelizacao",
    "configuracoes_ia",
    "configuracoes_restaurante",
    "distribuidores",
    "entradas_estoque",
    "grupo_modificadores",
    "historico_fidelidade",
    "insumos",
    "item_modificadores",
    "itens",
    "itens_contagem_estoque",
    "itens_entrada_estoque",
    "itens_nota_entrada",
    "lancamentos",
    "mensagens_whatsapp",
    "mesas",
    "motoboys",
    "movimentacoes_estoque",
    "notas_entrada",
    "observacoes_predefinidas",
    "opcao_modificadores",
    "otp_challenges",
    "pagamentos",
    "print_agent_tokens",
    "print_jobs",
    "produto_grupo_modificadores",
    "produtos",
    "public_rate_limits",
    "rascunhos_pedidos",
    "sessoes_contagem_estoque",
    "usuarios",
)


def _table_names(bind) -> set[str]:
    return set(sa.inspect(bind).get_table_names())


def _column_names(bind, table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(bind).get_columns(table)}


def _ensure_tenant_column(bind, table: str) -> None:
    if "restaurante_id" in _column_names(bind, table):
        return

    with op.batch_alter_table(table) as batch_op:
        batch_op.add_column(
            sa.Column(
                "restaurante_id",
                sa.Integer(),
                nullable=True,
            )
        )
        batch_op.create_foreign_key(
            f"fk_{table}_restaurante_id",
            "restaurantes",
            ["restaurante_id"],
            ["id"],
        )


def _backfill_from_parent(
    bind,
    table: str,
    parent_table: str,
    local_key: str,
    parent_key: str = "id",
) -> None:
    bind.execute(
        sa.text(
            f"""
            UPDATE {table}
            SET restaurante_id = (
                SELECT parent.restaurante_id
                FROM {parent_table} AS parent
                WHERE parent.{parent_key} = {table}.{local_key}
            )
            WHERE restaurante_id IS NULL
            """
        )
    )


def _backfill_group_modifiers(bind) -> None:
    bind.execute(
        sa.text(
            """
            UPDATE grupo_modificadores
            SET restaurante_id = (
                SELECT MIN(produto.restaurante_id)
                FROM produto_grupo_modificadores AS link
                JOIN produtos AS produto ON produto.id = link.produto_id
                WHERE link.grupo_id = grupo_modificadores.id
            )
            WHERE restaurante_id IS NULL
              AND (
                SELECT COUNT(DISTINCT produto.restaurante_id)
                FROM produto_grupo_modificadores AS link
                JOIN produtos AS produto ON produto.id = link.produto_id
                WHERE link.grupo_id = grupo_modificadores.id
              ) = 1
            """
        )
    )


def _backfill_motoboys(bind) -> None:
    bind.execute(
        sa.text(
            """
            UPDATE motoboys
            SET restaurante_id = (
                SELECT MIN(comanda.restaurante_id)
                FROM comandas AS comanda
                WHERE comanda.motoboy_id = motoboys.id
            )
            WHERE restaurante_id IS NULL
              AND (
                SELECT COUNT(DISTINCT comanda.restaurante_id)
                FROM comandas AS comanda
                WHERE comanda.motoboy_id = motoboys.id
              ) = 1
            """
        )
    )


def _backfill_single_tenant_legacy_rows(bind, tables: Sequence[str]) -> None:
    restaurant_count = bind.execute(
        sa.text("SELECT COUNT(*) FROM restaurantes")
    ).scalar_one()
    if restaurant_count != 1:
        return

    restaurante_id = bind.execute(
        sa.text("SELECT MIN(id) FROM restaurantes")
    ).scalar_one()
    for table in tables:
        bind.execute(
            sa.text(
                f"""
                UPDATE {table}
                SET restaurante_id = :restaurante_id
                WHERE restaurante_id IS NULL
                """
            ),
            {"restaurante_id": restaurante_id},
        )


def _assert_no_unscoped_rows(bind, tables: Sequence[str]) -> None:
    unresolved = []
    for table in tables:
        count = bind.execute(
            sa.text(f"SELECT COUNT(*) FROM {table} WHERE restaurante_id IS NULL")
        ).scalar_one()
        if count:
            unresolved.append(f"{table}={count}")

    if unresolved:
        raise RuntimeError(
            "Não foi possível determinar o restaurante de registros legados: "
            + ", ".join(unresolved)
        )


def _make_tenant_required(bind, table: str) -> None:
    with op.batch_alter_table(table) as batch_op:
        batch_op.alter_column(
            "restaurante_id",
            existing_type=sa.Integer(),
            nullable=False,
        )


def upgrade() -> None:
    bind = op.get_bind()
    existing_tables = _table_names(bind)
    tables = tuple(table for table in TENANT_TABLES if table in existing_tables)

    for table in tables:
        _ensure_tenant_column(bind, table)

    parent_backfills = (
        ("activity_logs", "usuarios", "garcom_id"),
        ("caixa_movimentacoes", "caixa_turnos", "turno_id"),
        ("historico_fidelidade", "comandas", "comanda_id"),
        ("item_modificadores", "itens", "item_id"),
        ("lancamentos", "comandas", "comanda_id"),
        ("observacoes_predefinidas", "categorias", "categoria_id"),
        ("opcao_modificadores", "grupo_modificadores", "grupo_id"),
        ("produto_grupo_modificadores", "produtos", "produto_id"),
    )
    for table, parent_table, local_key in parent_backfills:
        if table in existing_tables and parent_table in existing_tables:
            _backfill_from_parent(bind, table, parent_table, local_key)

    if {"grupo_modificadores", "produto_grupo_modificadores", "produtos"} <= existing_tables:
        _backfill_group_modifiers(bind)
    if {"motoboys", "comandas"} <= existing_tables:
        _backfill_motoboys(bind)

    _backfill_single_tenant_legacy_rows(bind, tables)
    _assert_no_unscoped_rows(bind, tables)

    for table in tables:
        _make_tenant_required(bind, table)


def downgrade() -> None:
    bind = op.get_bind()
    existing_tables = _table_names(bind)
    for table in TENANT_TABLES:
        if table in existing_tables and "restaurante_id" in _column_names(bind, table):
            with op.batch_alter_table(table) as batch_op:
                batch_op.alter_column(
                    "restaurante_id",
                    existing_type=sa.Integer(),
                    nullable=True,
                )
