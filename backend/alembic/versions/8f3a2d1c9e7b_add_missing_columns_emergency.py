"""add_missing_columns_emergency

Revision ID: 8f3a2d1c9e7b
Revises: dcbca6699d38
Create Date: 2026-07-11 14:31:00.000000

Migration de compatibilidade entre o schema inicial gerado antes do Alembic e
os models que passaram a ser a fonte de verdade. Precisa funcionar tanto em
banco legado quanto em reconstrução limpa, sem usar exceção de DDL como fluxo
normal (em PostgreSQL isso aborta a transação inteira).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "8f3a2d1c9e7b"
down_revision: Union[str, Sequence[str], None] = "dcbca6699d38"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _inspector(conn):
    return sa.inspect(conn)


def _column_exists(conn, table_name: str, column_name: str) -> bool:
    return column_name in {
        column["name"] for column in _inspector(conn).get_columns(table_name)
    }


def _index_exists(conn, table_name: str, index_name: str) -> bool:
    return index_name in {
        index["name"] for index in _inspector(conn).get_indexes(table_name)
    }


def _unique_exists(conn, table_name: str, unique_name: str) -> bool:
    return unique_name in {
        constraint.get("name")
        for constraint in _inspector(conn).get_unique_constraints(table_name)
    }


def _check_exists(conn, table_name: str, check_name: str) -> bool:
    return check_name in {
        constraint.get("name")
        for constraint in _inspector(conn).get_check_constraints(table_name)
    }


def _add_column_if_missing(
    conn,
    table_name: str,
    column_name: str,
    col_type,
    **kwargs,
) -> None:
    if _column_exists(conn, table_name, column_name):
        return
    op.add_column(table_name, sa.Column(column_name, col_type, **kwargs))


def _normalize_legacy_restaurants(conn) -> None:
    """Materializa campos públicos/configuráveis criados via ORM no período legado.

    Funções SECURITY DEFINER de migrations posteriores já dependem de ``slug``,
    ``logo_url`` e ``subtitulo``. Centralizar aqui a compatibilidade evita que uma
    reconstrução limpa dependa de um ``create_all`` executado fora do Alembic.
    """
    columns = (
        ("slug", sa.String(), {}),
        ("logo_url", sa.String(), {}),
        ("banner_url", sa.String(), {}),
        ("cardapio_logo_path", sa.String(), {}),
        ("cardapio_banner_path", sa.String(), {}),
        ("subtitulo", sa.String(), {}),
        ("sobre_nos", sa.String(), {}),
        ("endereco", sa.String(), {}),
        ("google_maps_url", sa.String(), {}),
        ("latitude", sa.Float(), {}),
        ("longitude", sa.Float(), {}),
        ("status_override", sa.String(), {"server_default": "Automático"}),
        ("socials", sa.JSON(), {}),
        ("horarios_funcionamento", sa.JSON(), {}),
        ("formas_pagamento_aceitas", sa.JSON(), {}),
        ("cor_primaria", sa.String(), {"server_default": "#00b894"}),
        ("cor_fundo", sa.String(), {"server_default": "#090a0f"}),
    )
    for name, column_type, kwargs in columns:
        _add_column_if_missing(
            conn,
            "restaurantes",
            name,
            column_type,
            nullable=True,
            **kwargs,
        )


def _normalize_legacy_users(conn) -> None:
    """Converte a forma `usuario/role` inicial para a identidade tenant atual.

    `usuario` e `role` permanecem como colunas legadas por compatibilidade de
    histórico, porém deixam de ser NOT NULL para não obrigar novos INSERTs do
    ORM a preencher campos que já não pertencem ao model.
    """
    _add_column_if_missing(conn, "usuarios", "telefone", sa.String(50), nullable=True)
    _add_column_if_missing(conn, "usuarios", "email", sa.String(100), nullable=True)
    _add_column_if_missing(conn, "usuarios", "cargo", sa.String(20), nullable=True)
    _add_column_if_missing(conn, "usuarios", "token_convite", sa.String(), nullable=True)
    _add_column_if_missing(
        conn,
        "usuarios",
        "token_expira_em",
        sa.DateTime(timezone=True),
        nullable=True,
    )
    _add_column_if_missing(
        conn,
        "usuarios",
        "status",
        sa.String(20),
        nullable=True,
        server_default="pendente_ativacao",
    )
    _add_column_if_missing(
        conn,
        "usuarios",
        "created_at",
        sa.DateTime(timezone=True),
        nullable=True,
        server_default=sa.func.now(),
    )

    columns = {
        column["name"]: column for column in _inspector(conn).get_columns("usuarios")
    }
    if "role" in columns:
        conn.execute(sa.text("""
            UPDATE usuarios
            SET cargo = COALESCE(NULLIF(cargo, ''), NULLIF(role, ''), 'garcom')
            WHERE cargo IS NULL OR cargo = ''
        """))
    else:
        conn.execute(sa.text("""
            UPDATE usuarios SET cargo = 'garcom'
            WHERE cargo IS NULL OR cargo = ''
        """))

    conn.execute(sa.text("""
        UPDATE usuarios
        SET status = 'ativo'
        WHERE status IS NULL OR status = '' OR status = 'pendente_ativacao'
    """))

    for legacy_name in ("usuario", "role"):
        if legacy_name in columns and columns[legacy_name].get("nullable") is False:
            op.alter_column(
                "usuarios",
                legacy_name,
                existing_type=columns[legacy_name]["type"],
                nullable=True,
            )
    if "senha_hash" in columns and columns["senha_hash"].get("nullable") is False:
        op.alter_column(
            "usuarios",
            "senha_hash",
            existing_type=columns["senha_hash"]["type"],
            nullable=True,
        )

    cargo_column = next(
        column for column in _inspector(conn).get_columns("usuarios")
        if column["name"] == "cargo"
    )
    if cargo_column.get("nullable") is not False:
        op.alter_column(
            "usuarios",
            "cargo",
            existing_type=cargo_column["type"],
            nullable=False,
        )

    if not _index_exists(conn, "usuarios", "ix_usuarios_email"):
        op.create_index("ix_usuarios_email", "usuarios", ["email"], unique=False)
    if not _index_exists(conn, "usuarios", "ix_usuarios_telefone"):
        op.create_index("ix_usuarios_telefone", "usuarios", ["telefone"], unique=False)

    if not _unique_exists(conn, "usuarios", "uq_usuarios_restaurante_email"):
        op.create_unique_constraint(
            "uq_usuarios_restaurante_email",
            "usuarios",
            ["restaurante_id", "email"],
        )
    if not _unique_exists(conn, "usuarios", "uq_usuarios_restaurante_telefone"):
        op.create_unique_constraint(
            "uq_usuarios_restaurante_telefone",
            "usuarios",
            ["restaurante_id", "telefone"],
        )

    if not _check_exists(conn, "usuarios", "ck_usuarios_cargo"):
        op.create_check_constraint(
            "ck_usuarios_cargo",
            "usuarios",
            "cargo IN ('admin', 'superadmin', 'caixa', 'garcom', 'gerente', 'motoboy')",
        )
    if not _check_exists(conn, "usuarios", "ck_usuarios_status"):
        op.create_check_constraint(
            "ck_usuarios_status",
            "usuarios",
            "status IS NULL OR status IN ('pendente_ativacao', 'ativo', 'inativo')",
        )


def upgrade() -> None:
    conn = op.get_bind()

    _normalize_legacy_restaurants(conn)
    _normalize_legacy_users(conn)

    _add_column_if_missing(conn, "comandas", "mesa_origem_id", sa.Integer())
    _add_column_if_missing(conn, "comandas", "delivery_status", sa.String())
    _add_column_if_missing(conn, "comandas", "delivery_taxa", sa.Float())
    _add_column_if_missing(conn, "comandas", "delivery_telefone", sa.String())
    _add_column_if_missing(conn, "comandas", "delivery_endereco", sa.String())
    _add_column_if_missing(conn, "comandas", "motoboy_id", sa.Integer())
    _add_column_if_missing(conn, "comandas", "status_comanda", sa.String())
    _add_column_if_missing(
        conn,
        "comandas",
        "valor_pago",
        sa.Float(),
        server_default="0",
    )
    _add_column_if_missing(conn, "comandas", "fechado_em", sa.DateTime())
    _add_column_if_missing(conn, "comandas", "criado_em", sa.DateTime())

    _add_column_if_missing(conn, "itens", "restaurante_id", sa.Integer())

    if conn.dialect.name == "postgresql":
        conn.execute(sa.text("""
            UPDATE itens
            SET restaurante_id = c.restaurante_id
            FROM comandas c
            WHERE itens.comanda_id = c.id
              AND itens.restaurante_id IS NULL
        """))
    else:
        conn.execute(sa.text("""
            UPDATE itens
            SET restaurante_id = (
                SELECT restaurante_id FROM comandas
                WHERE comandas.id = itens.comanda_id
            )
            WHERE restaurante_id IS NULL
        """))

    if not _index_exists(conn, "itens", "ix_itens_restaurante_id"):
        op.create_index(
            "ix_itens_restaurante_id",
            "itens",
            ["restaurante_id"],
            unique=False,
        )

    _add_column_if_missing(conn, "lancamentos", "numero_pedido", sa.Integer())


def downgrade() -> None:
    conn = op.get_bind()

    if _index_exists(conn, "itens", "ix_itens_restaurante_id"):
        op.drop_index("ix_itens_restaurante_id", table_name="itens")

    for table_name, column_name in (
        ("itens", "restaurante_id"),
        ("comandas", "mesa_origem_id"),
        ("comandas", "delivery_status"),
        ("comandas", "delivery_taxa"),
        ("comandas", "delivery_telefone"),
        ("comandas", "delivery_endereco"),
        ("comandas", "motoboy_id"),
        ("comandas", "status_comanda"),
        ("comandas", "valor_pago"),
        ("comandas", "fechado_em"),
        ("comandas", "criado_em"),
        ("lancamentos", "numero_pedido"),
    ):
        if _column_exists(conn, table_name, column_name):
            op.drop_column(table_name, column_name)
