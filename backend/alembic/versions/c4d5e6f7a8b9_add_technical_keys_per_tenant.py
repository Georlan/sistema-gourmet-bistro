"""add technical keys and tenant-scoped business identifiers

Revision ID: c4d5e6f7a8b9
Revises: b1c2d3e4f5a6
Create Date: 2026-07-22 21:00:00.000000

P0-01:
* categorias, produtos e mesas recebem PK técnica autoincrementável;
* seus IDs públicos passam a ser chaves de negócio únicas por restaurante;
* FKs que apontam para essas chaves incluem restaurante_id.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c4d5e6f7a8b9"
down_revision: Union[str, Sequence[str], None] = "b1c2d3e4f5a6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

LEGACY_FOREIGN_KEYS = (
    ("produtos", ("categoria_id",), "categorias"),
    ("observacoes_predefinidas", ("categoria_id",), "categorias"),
    ("comandas", ("mesa_id",), "mesas"),
    ("itens", ("produto_id",), "produtos"),
    ("produto_grupo_modificadores", ("produto_id",), "produtos"),
)

TENANT_POLICIES = (
    "categorias",
    "produtos",
    "mesas",
    "observacoes_predefinidas",
    "comandas",
    "itens",
    "produto_grupo_modificadores",
)


def _inspector():
    return sa.inspect(op.get_bind())


def _find_fk(table: str, columns: tuple[str, ...], referred_table: str):
    for fk in _inspector().get_foreign_keys(table):
        if (
            tuple(fk.get("constrained_columns") or ()) == columns
            and fk.get("referred_table") == referred_table
        ):
            return fk
    return None


def _reflected_fk_name(table: str, columns: tuple[str, ...], referred_table: str) -> str:
    fk = _find_fk(table, columns, referred_table)
    if fk and fk.get("name"):
        return fk["name"]
    # batch_alter_table aplica este nome às constraints anônimas do SQLite.
    return f"fk_{table}_{columns[0]}_{referred_table}"


def _drop_legacy_foreign_keys() -> None:
    for table, columns, referred_table in LEGACY_FOREIGN_KEYS:
        if _find_fk(table, columns, referred_table) is None:
            continue
        name = _reflected_fk_name(table, columns, referred_table)
        with op.batch_alter_table(
            table,
            recreate="always",
            naming_convention=NAMING_CONVENTION,
        ) as batch_op:
            batch_op.drop_constraint(name, type_="foreignkey")


def _assert_no_cross_tenant_rows() -> None:
    bind = op.get_bind()
    checks = {
        "produtos -> categorias": """
            SELECT COUNT(*) FROM produtos p
            JOIN categorias c ON c.id = p.categoria_id
            WHERE p.restaurante_id <> c.restaurante_id
        """,
        "comandas -> mesas": """
            SELECT COUNT(*) FROM comandas c
            JOIN mesas m ON m.id = c.mesa_id
            WHERE c.mesa_id IS NOT NULL AND c.restaurante_id <> m.restaurante_id
        """,
        "itens -> produtos": """
            SELECT COUNT(*) FROM itens i
            JOIN produtos p ON p.id = i.produto_id
            WHERE i.restaurante_id <> p.restaurante_id
        """,
    }
    invalid = []
    for label, sql in checks.items():
        count = bind.execute(sa.text(sql)).scalar_one()
        if count:
            invalid.append(f"{label}: {count}")
    if invalid:
        raise RuntimeError(
            "Migração P0-01 bloqueada: existem vínculos cruzados entre tenants. "
            "Corrija os dados antes de repetir a migração: " + ", ".join(invalid)
        )


def _backfill_child_tenants() -> None:
    bind = op.get_bind()

    # A migração anterior usava restaurante 1 como fallback. A categoria é a
    # fonte correta enquanto categoria.id ainda é global.
    bind.execute(sa.text("""
        UPDATE observacoes_predefinidas
        SET restaurante_id = (
            SELECT c.restaurante_id
            FROM categorias c
            WHERE c.id = observacoes_predefinidas.categoria_id
        )
        WHERE EXISTS (
            SELECT 1 FROM categorias c
            WHERE c.id = observacoes_predefinidas.categoria_id
        )
    """))

    pgm_columns = {column["name"] for column in _inspector().get_columns("produto_grupo_modificadores")}
    if "restaurante_id" not in pgm_columns:
        with op.batch_alter_table(
            "produto_grupo_modificadores",
            recreate="always",
            naming_convention=NAMING_CONVENTION,
        ) as batch_op:
            batch_op.add_column(sa.Column("restaurante_id", sa.Integer(), nullable=True))

    bind.execute(sa.text("""
        UPDATE produto_grupo_modificadores
        SET restaurante_id = (
            SELECT p.restaurante_id
            FROM produtos p
            WHERE p.id = produto_grupo_modificadores.produto_id
        )
        WHERE restaurante_id IS NULL
    """))

    missing = bind.execute(sa.text("""
        SELECT
            (SELECT COUNT(*) FROM observacoes_predefinidas WHERE restaurante_id IS NULL)
          + (SELECT COUNT(*) FROM produto_grupo_modificadores WHERE restaurante_id IS NULL)
    """)).scalar_one()
    if missing:
        raise RuntimeError(
            "Migração P0-01 bloqueada: há observações ou vínculos de modificador "
            "sem categoria/produto válido para determinar o restaurante."
        )

    with op.batch_alter_table(
        "observacoes_predefinidas",
        recreate="always",
        naming_convention=NAMING_CONVENTION,
    ) as batch_op:
        batch_op.alter_column("restaurante_id", existing_type=sa.Integer(), nullable=False)

    with op.batch_alter_table(
        "produto_grupo_modificadores",
        recreate="always",
        naming_convention=NAMING_CONVENTION,
    ) as batch_op:
        batch_op.alter_column("restaurante_id", existing_type=sa.Integer(), nullable=False)
        batch_op.create_index(
            "ix_produto_grupo_modificadores_restaurante_id",
            ["restaurante_id"],
            unique=False,
        )
        batch_op.create_foreign_key(
            "fk_produto_grupo_restaurante",
            "restaurantes",
            ["restaurante_id"],
            ["id"],
            ondelete="CASCADE",
        )


def _add_technical_primary_key(
    table: str,
    business_unique_name: str,
    business_columns: list[str],
) -> None:
    legacy_global_uniques = []
    if table == "categorias":
        for constraint in _inspector().get_unique_constraints(table):
            if tuple(constraint.get("column_names") or ()) == ("nome",):
                legacy_global_uniques.append(
                    constraint.get("name") or "uq_categorias_nome"
                )

    with op.batch_alter_table(
        table,
        recreate="always",
        naming_convention=NAMING_CONVENTION,
    ) as batch_op:
        batch_op.add_column(
            sa.Column("pk", sa.Integer(), autoincrement=True, nullable=False)
        )
        batch_op.drop_constraint(f"pk_{table}", type_="primary")
        for constraint_name in legacy_global_uniques:
            batch_op.drop_constraint(constraint_name, type_="unique")
        batch_op.create_primary_key(f"pk_{table}", ["pk"])
        batch_op.create_unique_constraint(business_unique_name, business_columns)


def _create_tenant_foreign_keys() -> None:
    definitions = (
        (
            "produtos", "fk_produtos_categoria_tenant", "categorias",
            ["restaurante_id", "categoria_id"], ["restaurante_id", "id"], "RESTRICT",
        ),
        (
            "observacoes_predefinidas", "fk_observacoes_categoria_tenant", "categorias",
            ["restaurante_id", "categoria_id"], ["restaurante_id", "id"], "CASCADE",
        ),
        (
            "comandas", "fk_comandas_mesa_tenant", "mesas",
            ["restaurante_id", "mesa_id"], ["restaurante_id", "id"], "RESTRICT",
        ),
        (
            "itens", "fk_itens_produto_tenant", "produtos",
            ["restaurante_id", "produto_id"], ["restaurante_id", "id"], "RESTRICT",
        ),
        (
            "produto_grupo_modificadores", "fk_produto_grupo_produto_tenant", "produtos",
            ["restaurante_id", "produto_id"], ["restaurante_id", "id"], "CASCADE",
        ),
    )
    for table, name, referred, local_cols, remote_cols, ondelete in definitions:
        with op.batch_alter_table(
            table,
            recreate="always",
            naming_convention=NAMING_CONVENTION,
        ) as batch_op:
            batch_op.create_foreign_key(
                name,
                referred,
                local_cols,
                remote_cols,
                ondelete=ondelete,
            )


def _restore_postgres_rls() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    for table in TENANT_POLICIES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
        op.execute(f"""
            CREATE POLICY tenant_isolation ON {table}
            USING (restaurante_id = current_setting('app.current_restaurante_id', true)::int)
            WITH CHECK (restaurante_id = current_setting('app.current_restaurante_id', true)::int)
        """)


def upgrade() -> None:
    _assert_no_cross_tenant_rows()
    _backfill_child_tenants()
    _drop_legacy_foreign_keys()

    _add_technical_primary_key(
        "categorias",
        "uq_categorias_restaurante_id_negocio",
        ["restaurante_id", "id"],
    )
    _add_technical_primary_key(
        "mesas",
        "uq_mesas_restaurante_numero",
        ["restaurante_id", "id"],
    )
    _add_technical_primary_key(
        "produtos",
        "uq_produtos_restaurante_id_negocio",
        ["restaurante_id", "id"],
    )

    _create_tenant_foreign_keys()
    _restore_postgres_rls()


def _assert_business_ids_are_globally_unique() -> None:
    bind = op.get_bind()
    for table in ("categorias", "produtos", "mesas"):
        duplicates = bind.execute(sa.text(f"""
            SELECT COUNT(*) FROM (
                SELECT id FROM {table} GROUP BY id HAVING COUNT(*) > 1
            ) duplicated
        """)).scalar_one()
        if duplicates:
            raise RuntimeError(
                f"Downgrade bloqueado: {table}.id possui {duplicates} valor(es) "
                "repetido(s) entre restaurantes."
            )


def downgrade() -> None:
    _assert_business_ids_are_globally_unique()

    composite_fks = (
        ("produtos", "fk_produtos_categoria_tenant"),
        ("observacoes_predefinidas", "fk_observacoes_categoria_tenant"),
        ("comandas", "fk_comandas_mesa_tenant"),
        ("itens", "fk_itens_produto_tenant"),
        ("produto_grupo_modificadores", "fk_produto_grupo_produto_tenant"),
    )
    for table, name in composite_fks:
        with op.batch_alter_table(
            table,
            recreate="always",
            naming_convention=NAMING_CONVENTION,
        ) as batch_op:
            batch_op.drop_constraint(name, type_="foreignkey")

    for table, unique_name in (
        ("produtos", "uq_produtos_restaurante_id_negocio"),
        ("mesas", "uq_mesas_restaurante_numero"),
        ("categorias", "uq_categorias_restaurante_id_negocio"),
    ):
        with op.batch_alter_table(
            table,
            recreate="always",
            naming_convention=NAMING_CONVENTION,
        ) as batch_op:
            batch_op.drop_constraint(f"pk_{table}", type_="primary")
            batch_op.drop_constraint(unique_name, type_="unique")
            batch_op.drop_column("pk")
            batch_op.create_primary_key(f"pk_{table}", ["id"])

    with op.batch_alter_table(
        "produto_grupo_modificadores",
        recreate="always",
        naming_convention=NAMING_CONVENTION,
    ) as batch_op:
        batch_op.drop_constraint("fk_produto_grupo_restaurante", type_="foreignkey")
        batch_op.drop_index("ix_produto_grupo_modificadores_restaurante_id")
        batch_op.drop_column("restaurante_id")

    legacy_definitions = (
        ("produtos", "categorias", ["categoria_id"], ["id"]),
        ("observacoes_predefinidas", "categorias", ["categoria_id"], ["id"]),
        ("comandas", "mesas", ["mesa_id"], ["id"]),
        ("itens", "produtos", ["produto_id"], ["id"]),
        ("produto_grupo_modificadores", "produtos", ["produto_id"], ["id"]),
    )
    for table, referred, local_cols, remote_cols in legacy_definitions:
        with op.batch_alter_table(
            table,
            recreate="always",
            naming_convention=NAMING_CONVENTION,
        ) as batch_op:
            batch_op.create_foreign_key(
                f"fk_{table}_{local_cols[0]}_{referred}",
                referred,
                local_cols,
                remote_cols,
            )

    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE produto_grupo_modificadores DISABLE ROW LEVEL SECURITY")
        for table in TENANT_POLICIES[:-1]:
            op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
            op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
            op.execute(f"""
                CREATE POLICY tenant_isolation ON {table}
                USING (restaurante_id = current_setting('app.current_restaurante_id', true)::int)
                WITH CHECK (restaurante_id = current_setting('app.current_restaurante_id', true)::int)
            """)
