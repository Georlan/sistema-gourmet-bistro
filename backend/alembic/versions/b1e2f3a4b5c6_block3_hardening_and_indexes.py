"""Block 3 foreign key indexes, WhatsApp partial index and backfill, and complete RLS InitPlan normalization.

Revision ID: b1e2f3a4b5c6
Revises: b3c4d5e6f709
Create Date: 2026-10-17 14:40:00.000000
"""

from typing import Sequence, Union

from alembic import op

revision: str = "b1e2f3a4b5c6"
down_revision: Union[str, Sequence[str], None] = "b3c4d5e6f709"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return

    # 1. High-impact foreign key indexes to prevent SeqScans during joins, cascades and updates
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_itens_lancamento_id
        ON public.itens (lancamento_id)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_item_modificadores_item_id
        ON public.item_modificadores (item_id)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_item_modificadores_opcao_modificador_id
        ON public.item_modificadores (opcao_modificador_id)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_pagamentos_comanda_id
        ON public.pagamentos (comanda_id)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_pagamentos_turno_id
        ON public.pagamentos (turno_id)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_caixa_movimentacoes_turno_id
        ON public.caixa_movimentacoes (turno_id)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_comandas_garcom_id
        ON public.comandas (garcom_id)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_direct_pix_receipts_invoice_id
        ON public.direct_pix_receipts (invoice_id)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_atendimento_comandas_atendimento_id
        ON public.atendimento_comandas (atendimento_id)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_smartpos_payment_intent_events_intent_id
        ON public.smartpos_payment_intent_events (intent_id)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_scheduled_orders_comanda_id
        ON public.scheduled_orders (comanda_id)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_fiscal_documents_comanda_id
        ON public.fiscal_documents (comanda_id)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_fiscal_payments_pagamento_id
        ON public.fiscal_payments (pagamento_id)
        """
    )

    # 2. Backfill orphan WhatsApp notifications linked to comandas
    op.execute(
        """
        UPDATE public.notificacoes_whatsapp nw
        SET restaurante_id = c.restaurante_id
        FROM public.comandas c
        WHERE nw.restaurante_id IS NULL
          AND nw.comanda_id IS NOT NULL
          AND nw.comanda_id = c.id
        """
    )

    # 3. Partial composite index for WhatsApp webhook lookup
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_notificacoes_whatsapp_wamid_tenant
        ON public.notificacoes_whatsapp (wamid, restaurante_id)
        WHERE restaurante_id IS NOT NULL
        """
    )

    # 4. Normalize ALL remaining RLS policies across the public schema to use InitPlan
    op.execute(
        """
        DO $$
        DECLARE
            pol RECORD;
        BEGIN
            FOR pol IN
                SELECT schemaname, tablename, policyname, cmd
                FROM pg_policies
                WHERE schemaname = 'public'
                  AND (
                      (qual LIKE '%current_setting%app.current_restaurante_id%' AND qual NOT LIKE '%SELECT current_setting%')
                      OR
                      (with_check LIKE '%current_setting%app.current_restaurante_id%' AND with_check NOT LIKE '%SELECT current_setting%')
                  )
                  AND tablename <> 'restaurantes'
            LOOP
                IF pol.cmd = 'SELECT' THEN
                    EXECUTE format(
                        'ALTER POLICY %I ON public.%I USING (restaurante_id = NULLIF((SELECT current_setting(%L, true)), %L)::integer)',
                        pol.policyname, pol.tablename, 'app.current_restaurante_id', ''
                    );
                ELSIF pol.cmd = 'INSERT' THEN
                    EXECUTE format(
                        'ALTER POLICY %I ON public.%I WITH CHECK (restaurante_id = NULLIF((SELECT current_setting(%L, true)), %L)::integer)',
                        pol.policyname, pol.tablename, 'app.current_restaurante_id', ''
                    );
                ELSIF pol.cmd = 'UPDATE' THEN
                    EXECUTE format(
                        'ALTER POLICY %I ON public.%I USING (restaurante_id = NULLIF((SELECT current_setting(%L, true)), %L)::integer) WITH CHECK (restaurante_id = NULLIF((SELECT current_setting(%L, true)), %L)::integer)',
                        pol.policyname, pol.tablename, 'app.current_restaurante_id', '', 'app.current_restaurante_id', ''
                    );
                ELSIF pol.cmd = 'DELETE' THEN
                    EXECUTE format(
                        'ALTER POLICY %I ON public.%I USING (restaurante_id = NULLIF((SELECT current_setting(%L, true)), %L)::integer)',
                        pol.policyname, pol.tablename, 'app.current_restaurante_id', ''
                    );
                ELSIF pol.cmd = 'ALL' THEN
                    EXECUTE format(
                        'ALTER POLICY %I ON public.%I USING (restaurante_id = NULLIF((SELECT current_setting(%L, true)), %L)::integer) WITH CHECK (restaurante_id = NULLIF((SELECT current_setting(%L, true)), %L)::integer)',
                        pol.policyname, pol.tablename, 'app.current_restaurante_id', '', 'app.current_restaurante_id', ''
                    );
                END IF;
            END LOOP;
        END $$;
        """
    )


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return

    op.execute("DROP INDEX IF EXISTS public.ix_notificacoes_whatsapp_wamid_tenant")
    op.execute("DROP INDEX IF EXISTS public.ix_fiscal_payments_pagamento_id")
    op.execute("DROP INDEX IF EXISTS public.ix_fiscal_documents_comanda_id")
    op.execute("DROP INDEX IF EXISTS public.ix_scheduled_orders_comanda_id")
    op.execute("DROP INDEX IF EXISTS public.ix_smartpos_payment_intent_events_intent_id")
    op.execute("DROP INDEX IF EXISTS public.ix_atendimento_comandas_atendimento_id")
    op.execute("DROP INDEX IF EXISTS public.ix_direct_pix_receipts_invoice_id")
    op.execute("DROP INDEX IF EXISTS public.ix_comandas_garcom_id")
    op.execute("DROP INDEX IF EXISTS public.ix_caixa_movimentacoes_turno_id")
    op.execute("DROP INDEX IF EXISTS public.ix_pagamentos_turno_id")
    op.execute("DROP INDEX IF EXISTS public.ix_pagamentos_comanda_id")
    op.execute("DROP INDEX IF EXISTS public.ix_item_modificadores_opcao_modificador_id")
    op.execute("DROP INDEX IF EXISTS public.ix_item_modificadores_item_id")
    op.execute("DROP INDEX IF EXISTS public.ix_itens_lancamento_id")
