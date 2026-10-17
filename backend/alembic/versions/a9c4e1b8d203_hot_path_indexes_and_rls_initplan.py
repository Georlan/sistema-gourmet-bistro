"""Hot-path composite indexes, active print_jobs partial index, and RLS InitPlan normalization.

Revision ID: a9c4e1b8d203
Revises: f4b871c2d390
Create Date: 2026-10-17 12:20:00.000000
"""

from typing import Sequence, Union

from alembic import op

revision: str = "a9c4e1b8d203"
down_revision: Union[str, Sequence[str], None] = "f4b871c2d390"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_comandas_tenant_cliente_fechada
        ON public.comandas (restaurante_id, cliente_id, fechada)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_comandas_tenant_fechada_fechado_em
        ON public.comandas (restaurante_id, fechada, fechado_em, criado_em)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_lancamentos_tenant_comanda_status
        ON public.lancamentos (restaurante_id, comanda_id, status)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_itens_tenant_comanda_status
        ON public.itens (restaurante_id, comanda_id, status)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_pagamentos_tenant_status_created
        ON public.pagamentos (restaurante_id, status, criado_em)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_print_jobs_tenant_active_queue
        ON public.print_jobs (restaurante_id, status, claimed_at, created_at)
        WHERE status IN ('pending', 'claimed')
        """
    )

    # Normalize tenant_isolation RLS policies to use (SELECT current_setting(...))
    # so PostgreSQL evaluates the GUC once per statement via InitPlan instead of per row.
    op.execute(
        """
        DO $$
        DECLARE
            rec RECORD;
        BEGIN
            IF EXISTS (
                SELECT 1 FROM pg_policies
                WHERE schemaname = 'public'
                  AND tablename = 'restaurantes'
                  AND policyname = 'tenant_isolation'
            ) THEN
                ALTER POLICY tenant_isolation ON public.restaurantes
                    USING (id = NULLIF((SELECT current_setting('app.current_restaurante_id', true)), '')::integer)
                    WITH CHECK (id = NULLIF((SELECT current_setting('app.current_restaurante_id', true)), '')::integer);
            END IF;

            FOR rec IN
                SELECT p.tablename
                FROM pg_policies p
                JOIN information_schema.columns c
                  ON c.table_schema = p.schemaname
                 AND c.table_name = p.tablename
                 AND c.column_name = 'restaurante_id'
                WHERE p.schemaname = 'public'
                  AND p.policyname = 'tenant_isolation'
                  AND p.tablename <> 'restaurantes'
            LOOP
                EXECUTE format(
                    'ALTER POLICY tenant_isolation ON public.%I '
                    'USING (restaurante_id = NULLIF((SELECT current_setting(''app.current_restaurante_id'', true)), '''')::integer) '
                    'WITH CHECK (restaurante_id = NULLIF((SELECT current_setting(''app.current_restaurante_id'', true)), '''')::integer)',
                    rec.tablename
                );
            END LOOP;
        END $$;
        """
    )


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return

    op.execute("DROP INDEX IF EXISTS public.ix_print_jobs_tenant_active_queue")
    op.execute("DROP INDEX IF EXISTS public.ix_pagamentos_tenant_status_created")
    op.execute("DROP INDEX IF EXISTS public.ix_itens_tenant_comanda_status")
    op.execute("DROP INDEX IF EXISTS public.ix_lancamentos_tenant_comanda_status")
    op.execute("DROP INDEX IF EXISTS public.ix_comandas_tenant_fechada_fechado_em")
    op.execute("DROP INDEX IF EXISTS public.ix_comandas_tenant_cliente_fechada")
