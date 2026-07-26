"""harden database integrity and RLS

Revision ID: fd136dcefa5c
Revises: f7a8b9c0d1e2
Create Date: 2026-07-27 05:56:58.362931

P0/P1 database hardening:

* scopes tenant policies to the runtime role and caches the tenant GUC lookup;
* removes unsafe database-side tenant ``DEFAULT 1`` fallbacks;
* prevents future accidental Data API exposure through default privileges;
* adds the foreign-key indexes reported by the Supabase advisor;
* adds validated domain checks around financial and workflow state;
* tunes autovacuum for the small, high-churn operational tables.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'fd136dcefa5c'
down_revision: Union[str, Sequence[str], None] = 'f7a8b9c0d1e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


FK_INDEXES: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    (
        "ix_caixa_movimentacoes_usuario_fk",
        "caixa_movimentacoes",
        ("usuario_id",),
    ),
    (
        "ix_comandas_tenant_mesa_fk",
        "comandas",
        ("restaurante_id", "mesa_id"),
    ),
    (
        "ix_entradas_estoque_distribuidor_fk",
        "entradas_estoque",
        ("distribuidor_id",),
    ),
    (
        "ix_entradas_estoque_usuario_fk",
        "entradas_estoque",
        ("usuario_id",),
    ),
    (
        "ix_itens_tenant_produto_fk",
        "itens",
        ("restaurante_id", "produto_id"),
    ),
    (
        "ix_itens_contagem_contagem_fk",
        "itens_contagem_estoque",
        ("contagem_id",),
    ),
    (
        "ix_itens_contagem_insumo_fk",
        "itens_contagem_estoque",
        ("insumo_id",),
    ),
    (
        "ix_itens_entrada_entrada_fk",
        "itens_entrada_estoque",
        ("entrada_id",),
    ),
    (
        "ix_itens_entrada_insumo_fk",
        "itens_entrada_estoque",
        ("insumo_id",),
    ),
    (
        "ix_movimentacoes_estoque_usuario_fk",
        "movimentacoes_estoque",
        ("usuario_id",),
    ),
    (
        "ix_observacoes_tenant_categoria_fk",
        "observacoes_predefinidas",
        ("restaurante_id", "categoria_id"),
    ),
    (
        "ix_produto_grupo_tenant_produto_fk",
        "produto_grupo_modificadores",
        ("restaurante_id", "produto_id"),
    ),
    (
        "ix_produtos_tenant_categoria_fk",
        "produtos",
        ("restaurante_id", "categoria_id"),
    ),
    (
        "ix_sessoes_contagem_usuario_fk",
        "sessoes_contagem_estoque",
        ("usuario_id",),
    ),
)


CHECK_CONSTRAINTS: tuple[tuple[str, str, str], ...] = (
    (
        "produtos",
        "ck_produtos_preco_nonnegative_finite",
        "preco >= 0 AND preco < 'Infinity'::double precision",
    ),
    (
        "itens",
        "ck_itens_preco_unit_nonnegative_finite",
        "preco_unit >= 0 AND preco_unit < 'Infinity'::double precision",
    ),
    (
        "pagamentos",
        "ck_pagamentos_valor_positive_finite",
        "valor > 0 AND valor < 'Infinity'::double precision",
    ),
    (
        "comandas",
        "ck_comandas_valores_nonnegative_finite",
        """
        valor_pago >= 0
        AND valor_pago < 'Infinity'::double precision
        AND (
            delivery_taxa IS NULL
            OR (
                delivery_taxa >= 0
                AND delivery_taxa < 'Infinity'::double precision
            )
        )
        """,
    ),
    (
        "caixa_turnos",
        "ck_caixa_turnos_valores_nonnegative_finite",
        """
        saldo_inicial >= 0
        AND saldo_inicial < 'Infinity'::double precision
        AND (
            declarado_dinheiro IS NULL
            OR (
                declarado_dinheiro >= 0
                AND declarado_dinheiro < 'Infinity'::double precision
            )
        )
        AND (
            declarado_pix IS NULL
            OR (
                declarado_pix >= 0
                AND declarado_pix < 'Infinity'::double precision
            )
        )
        AND (
            declarado_cartao IS NULL
            OR (
                declarado_cartao >= 0
                AND declarado_cartao < 'Infinity'::double precision
            )
        )
        """,
    ),
    (
        "caixa_movimentacoes",
        "ck_caixa_movimentacoes_valor_positive_finite",
        "valor > 0 AND valor < 'Infinity'::double precision",
    ),
    (
        "clientes",
        "ck_clientes_cashback_nonnegative_finite",
        """
        saldo_cashback >= 0
        AND saldo_cashback < 'Infinity'::double precision
        """,
    ),
    (
        "configuracoes_restaurante",
        "ck_config_restaurante_taxa_servico",
        "taxa_servico_padrao IS NULL OR taxa_servico_padrao BETWEEN 0 AND 100",
    ),
    (
        "configuracoes_ia",
        "ck_config_ia_desconto_maximo",
        "desconto_maximo IS NULL OR desconto_maximo BETWEEN 0 AND 100",
    ),
    (
        "comandas",
        "ck_comandas_idempotency_nonblank",
        "idempotency_key IS NULL OR btrim(idempotency_key) <> ''",
    ),
    (
        "pagamentos",
        "ck_pagamentos_idempotency_nonblank",
        "idempotency_key IS NULL OR btrim(idempotency_key) <> ''",
    ),
    (
        "usuarios",
        "ck_usuarios_cargo",
        """
        cargo IN (
            'admin', 'superadmin', 'caixa', 'garcom', 'gerente', 'motoboy'
        )
        """,
    ),
    (
        "usuarios",
        "ck_usuarios_status",
        """
        status IS NULL
        OR status IN ('pendente_ativacao', 'ativo', 'inativo')
        """,
    ),
    (
        "comandas",
        "ck_comandas_tipo",
        """
        tipo IS NULL
        OR tipo IN ('Consumo no Local', 'Retirada', 'Entrega', 'Delivery')
        """,
    ),
    (
        "comandas",
        "ck_comandas_delivery_status",
        """
        delivery_status IS NULL
        OR delivery_status IN (
            'analise', 'pendente', 'producao', 'pronto', 'transito', 'finalizado',
            'recusado'
        )
        """,
    ),
    (
        "comandas",
        "ck_comandas_status_comanda",
        """
        status_comanda IS NULL
        OR status_comanda = 'aguardando_pagamento'
        """,
    ),
    (
        "itens",
        "ck_itens_status",
        "status IS NULL OR status IN ('preparando', 'pronto', 'entregue', 'cancelado')",
    ),
    (
        "pagamentos",
        "ck_pagamentos_metodo",
        """
        metodo IN (
            'dinheiro', 'pix', 'cartao', 'cartao_debito', 'cartao_credito'
        )
        """,
    ),
    (
        "pagamentos",
        "ck_pagamentos_status",
        "status IS NULL OR status IN ('pendente', 'aprovado', 'cancelado')",
    ),
    (
        "caixa_turnos",
        "ck_caixa_turnos_status",
        "status IS NULL OR status IN ('aberto', 'fechado')",
    ),
    (
        "caixa_movimentacoes",
        "ck_caixa_movimentacoes_tipo",
        "tipo IN ('suprimento', 'sangria')",
    ),
)


AUTOVACUUM_SETTINGS: dict[str, tuple[int, int]] = {
    "comandas": (20, 20),
    "itens": (20, 20),
    "pagamentos": (20, 20),
    "print_jobs": (10, 10),
    "print_agent_tokens": (5, 5),
}


LEGACY_TENANT_DEFAULT_TABLES: tuple[str, ...] = (
    "categorias",
    "comandas",
    "configuracoes_restaurante",
    "insumos",
    "mesas",
    "pagamentos",
    "produtos",
    "usuarios",
)


def _quote(bind, identifier: str) -> str:
    return bind.dialect.identifier_preparer.quote(identifier)


def _tenant_tables(bind) -> list[str]:
    rows = bind.execute(sa.text("""
        SELECT DISTINCT table_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name = 'restaurante_id'
        ORDER BY table_name
    """))
    return [row[0] for row in rows]


def _replace_tenant_policy(bind, table: str, optimized: bool = True) -> None:
    quoted = _quote(bind, table)
    tenant_column = "id" if table == "restaurantes" else "restaurante_id"
    quoted_tenant_column = _quote(bind, tenant_column)
    target_role = "koma_app" if optimized else "PUBLIC"

    if optimized:
        tenant_expression = """
            (
                SELECT NULLIF(
                    current_setting('app.current_restaurante_id', true), ''
                )::integer
            )
        """
    else:
        tenant_expression = """
            NULLIF(
                current_setting('app.current_restaurante_id', true), ''
            )::integer
        """

    op.execute(f"ALTER TABLE public.{quoted} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE public.{quoted} FORCE ROW LEVEL SECURITY")
    op.execute(
        f"DROP POLICY IF EXISTS tenant_isolation ON public.{quoted}"
    )
    op.execute(f"""
        CREATE POLICY tenant_isolation ON public.{quoted}
        AS PERMISSIVE
        FOR ALL
        TO {target_role}
        USING ({quoted_tenant_column} = {tenant_expression})
        WITH CHECK ({quoted_tenant_column} = {tenant_expression})
    """)


def _add_check_constraint(
    bind,
    table: str,
    constraint_name: str,
    expression: str,
) -> None:
    exists = bind.execute(
        sa.text("""
            SELECT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conrelid = to_regclass(:qualified_table)
                  AND conname = :constraint_name
            )
        """),
        {
            "qualified_table": f"public.{table}",
            "constraint_name": constraint_name,
        },
    ).scalar_one()

    quoted_table = _quote(bind, table)
    quoted_constraint = _quote(bind, constraint_name)
    if not exists:
        op.execute(f"""
            ALTER TABLE public.{quoted_table}
            ADD CONSTRAINT {quoted_constraint}
            CHECK ({expression}) NOT VALID
        """)
    op.execute(f"""
        ALTER TABLE public.{quoted_table}
        VALIDATE CONSTRAINT {quoted_constraint}
    """)


def _secure_default_privileges() -> None:
    # New application objects must be private unless a migration explicitly
    # exposes them. Existing intentional public-menu grants are not changed.
    op.execute("""
        ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
        REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
        ON TABLES FROM anon, authenticated
    """)
    op.execute("""
        ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
        REVOKE USAGE, SELECT, UPDATE
        ON SEQUENCES FROM anon, authenticated
    """)
    op.execute("""
        ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
        REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated
    """)
    op.execute("""
        ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO koma_app
    """)
    op.execute("""
        ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
        GRANT USAGE, SELECT ON SEQUENCES TO koma_app
    """)


def _secure_alembic_version(bind) -> None:
    if not sa.inspect(bind).has_table("alembic_version", schema="public"):
        return

    op.execute(
        "ALTER TABLE public.alembic_version ENABLE ROW LEVEL SECURITY"
    )
    op.execute(
        "DROP POLICY IF EXISTS alembic_migration_admin "
        "ON public.alembic_version"
    )
    op.execute("""
        CREATE POLICY alembic_migration_admin
        ON public.alembic_version
        AS PERMISSIVE
        FOR ALL
        TO postgres
        USING (true)
        WITH CHECK (true)
    """)
    op.execute(
        "REVOKE ALL ON TABLE public.alembic_version "
        "FROM PUBLIC, anon, authenticated, service_role, koma_app"
    )


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    # Falha rápido em caso de DDL concorrente, em vez de bloquear o deploy
    # indefinidamente. A migração inteira continua transacional.
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute("SET LOCAL statement_timeout = '2min'")

    # The runtime role is created by d5e6f7a8b9c0 and inherited by
    # ``koma_runtime``. Restricting the policy to this role prevents the
    # public-cardapio policies from being OR'ed with the private PDV policy.
    for table in ["restaurantes", *_tenant_tables(bind)]:
        _replace_tenant_policy(bind, table)

    # A missing tenant must fail closed instead of silently writing to tenant 1.
    for table in _tenant_tables(bind):
        quoted = _quote(bind, table)
        op.execute(
            f"ALTER TABLE public.{quoted} "
            "ALTER COLUMN restaurante_id DROP DEFAULT"
        )

    _secure_default_privileges()
    _secure_alembic_version(bind)

    for index_name, table, columns in FK_INDEXES:
        quoted_columns = ", ".join(_quote(bind, column) for column in columns)
        op.execute(
            f"CREATE INDEX IF NOT EXISTS {_quote(bind, index_name)} "
            f"ON public.{_quote(bind, table)} ({quoted_columns})"
        )

    for table, constraint_name, expression in CHECK_CONSTRAINTS:
        _add_check_constraint(
            bind,
            table,
            constraint_name,
            expression,
        )

    for table, (vacuum_threshold, analyze_threshold) in (
        AUTOVACUUM_SETTINGS.items()
    ):
        op.execute(f"""
            ALTER TABLE public.{_quote(bind, table)} SET (
                autovacuum_vacuum_scale_factor = 0.05,
                autovacuum_vacuum_threshold = {vacuum_threshold},
                autovacuum_analyze_scale_factor = 0.02,
                autovacuum_analyze_threshold = {analyze_threshold}
            )
        """)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    for table, _ in AUTOVACUUM_SETTINGS.items():
        op.execute(f"""
            ALTER TABLE public.{_quote(bind, table)} RESET (
                autovacuum_vacuum_scale_factor,
                autovacuum_vacuum_threshold,
                autovacuum_analyze_scale_factor,
                autovacuum_analyze_threshold
            )
        """)

    for table, constraint_name, _ in reversed(CHECK_CONSTRAINTS):
        op.execute(
            f"ALTER TABLE public.{_quote(bind, table)} "
            f"DROP CONSTRAINT IF EXISTS {_quote(bind, constraint_name)}"
        )

    for index_name, _, _ in reversed(FK_INDEXES):
        op.execute(
            f"DROP INDEX IF EXISTS public.{_quote(bind, index_name)}"
        )

    for table in LEGACY_TENANT_DEFAULT_TABLES:
        op.execute(
            f"ALTER TABLE public.{_quote(bind, table)} "
            "ALTER COLUMN restaurante_id SET DEFAULT 1"
        )

    for table in ["restaurantes", *_tenant_tables(bind)]:
        _replace_tenant_policy(bind, table, optimized=False)

    op.execute(
        "DROP POLICY IF EXISTS alembic_migration_admin "
        "ON public.alembic_version"
    )
    op.execute(
        "GRANT SELECT, INSERT, UPDATE, DELETE "
        "ON TABLE public.alembic_version TO koma_app"
    )
    op.execute(
        "GRANT ALL ON TABLE public.alembic_version TO service_role"
    )

    # Intentionally do not reopen the insecure default grants to
    # anon/authenticated. Security defaults are forward-only hardening.
