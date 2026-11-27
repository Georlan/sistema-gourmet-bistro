"""Create B8 Finance, Supply Chain, Historical Cost and Production tables with RLS."""

from __future__ import annotations

from alembic import op
from sqlalchemy import inspect

revision = "x4b5c6d7e8f9"
down_revision = "w3a4b5c6d7e8"
branch_labels = None
depends_on = None

B8_TABLES = (
    "b8_finance_categorias",
    "b8_finance_contas",
    "b8_finance_recorrencias",
    "b8_contas_pagar",
    "b8_contas_pagar_parcelas",
    "b8_contas_pagar_baixas",
    "b8_contas_receber",
    "b8_contas_receber_baixas",
    "b8_finance_movimentacoes",
    "b8_finance_auditoria_logs",
    "b8_sub_receitas",
    "b8_sub_receita_ingredientes",
    "b8_fichas_tecnicas_componentes",
    "b8_itens_custo_snapshots",
    "b8_fornecedor_insumo_depara",
    "b8_pedidos_compra",
    "b8_pedidos_compra_itens",
    "b8_lotes_estoque",
    "b8_ordens_producao",
    "b8_ordens_producao_consumos",
    "b8_registros_buffet_lotes",
)


def _enable_tenant_rls(table_name: str) -> None:
    tenant_expr = "restaurante_id = (SELECT NULLIF(current_setting('app.current_restaurante_id', true), '')::integer)"
    op.execute(f"ALTER TABLE public.{table_name} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE public.{table_name} FORCE ROW LEVEL SECURITY")
    op.execute(f"""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'koma_app') THEN
                REVOKE ALL ON TABLE public.{table_name} FROM koma_app;
                GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.{table_name} TO koma_app;
            END IF;
        END
        $$;
    """)
    for action, suffix in (("SELECT", "select"), ("INSERT", "insert"), ("UPDATE", "update"), ("DELETE", "delete")):
        policy = f"{table_name}_tenant_{suffix}"
        clause = f"WITH CHECK ({tenant_expr})" if action == "INSERT" else (
            f"USING ({tenant_expr}) WITH CHECK ({tenant_expr})" if action == "UPDATE" else f"USING ({tenant_expr})"
        )
        op.execute(f"""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_policies
                    WHERE schemaname = 'public' AND tablename = '{table_name}' AND policyname = '{policy}'
                ) THEN
                    CREATE POLICY {policy} ON public.{table_name} FOR {action} TO koma_app {clause};
                END IF;
            END
            $$;
        """)


def upgrade() -> None:
    from app.database import Base
    from app import b8_finance_models, b8_supply_models  # noqa: F401

    bind = op.get_bind()
    inspector = inspect(bind)
    existing = set(inspector.get_table_names())

    tables_to_create = [
        Base.metadata.tables[name]
        for name in B8_TABLES
        if name in Base.metadata.tables and name not in existing
    ]
    if tables_to_create:
        Base.metadata.create_all(bind=bind, tables=tables_to_create, checkfirst=True)

    if bind.dialect.name == "postgresql":
        for table_name in B8_TABLES:
            _enable_tenant_rls(table_name)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    existing = set(inspector.get_table_names())

    if bind.dialect.name == "postgresql":
        for table_name in reversed(B8_TABLES):
            if table_name not in existing:
                continue
            for suffix in ("delete", "update", "insert", "select"):
                op.execute(f"DROP POLICY IF EXISTS {table_name}_tenant_{suffix} ON public.{table_name}")

    for table_name in reversed(B8_TABLES):
        if table_name in existing:
            op.drop_table(table_name)
