"""revoke legacy browser access to tenant data

Revision ID: f2a3b4c5d6e7
Revises: e1f2a3b4c5d6
Create Date: 2026-08-10 15:00:00.000000

The browser now uses only the tenant-aware FastAPI surface. This migration
removes legacy Data API policies/grants that exposed customer and order rows
to the public Supabase roles, removes the same permissive policy left behind
on cash movements, and retires the obsolete Postgres Changes publication.
"""
from typing import Sequence, Union

from alembic import op


revision: str = "f2a3b4c5d6e7"
down_revision: Union[str, Sequence[str], None] = "e1f2a3b4c5d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    for table in ("caixa_movimentacoes", "clientes", "comandas"):
        op.execute(
            f"DROP POLICY IF EXISTS tenant_isolation_{table} ON public.{table}"
        )

    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
                REVOKE ALL ON TABLE public.clientes FROM anon;
                REVOKE ALL ON TABLE public.comandas FROM anon;
            END IF;
            IF EXISTS (
                SELECT 1 FROM pg_roles WHERE rolname = 'authenticated'
            ) THEN
                REVOKE ALL ON TABLE public.clientes FROM authenticated;
                REVOKE ALL ON TABLE public.comandas FROM authenticated;
            END IF;
        END
        $$
    """)

    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM pg_publication_tables
                WHERE pubname = 'supabase_realtime'
                  AND schemaname = 'public'
                  AND tablename = 'clientes'
            ) THEN
                ALTER PUBLICATION supabase_realtime DROP TABLE public.clientes;
            END IF;
            IF EXISTS (
                SELECT 1
                FROM pg_publication_tables
                WHERE pubname = 'supabase_realtime'
                  AND schemaname = 'public'
                  AND tablename = 'comandas'
            ) THEN
                ALTER PUBLICATION supabase_realtime DROP TABLE public.comandas;
            END IF;
        END
        $$
    """)


def downgrade() -> None:
    # Intentionally irreversible: restoring unauthenticated access would
    # reintroduce cross-tenant customer and order exposure.
    return
