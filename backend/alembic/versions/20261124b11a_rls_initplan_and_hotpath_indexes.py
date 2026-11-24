"""Normalize remaining RLS InitPlan policies, enforce FORCE RLS on product families, drop duplicate indexes and add hot-path indexes (B11 PR3).

Revision ID: 20261124b11a
Revises: 20261120a1b2
Create Date: 2026-11-24 14:22:00.000000
"""

from typing import Sequence, Union

from alembic import op

revision: str = "20261124b11a"
down_revision: Union[str, Sequence[str], None] = "20261120a1b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_INITPLAN_TENANT_EXPR = (
    "restaurante_id = NULLIF((SELECT current_setting('app.current_restaurante_id', true)), '')::integer"
)
_LEGACY_TENANT_EXPR = (
    "restaurante_id = NULLIF(current_setting('app.current_restaurante_id', true), '')::integer"
)


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return

    op.execute("SET LOCAL lock_timeout = '5s'")

    # 1. Normalize the 6 RLS policies that still evaluated current_setting() per row.
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON public.cardapios")
    op.execute(
        f"""
        CREATE POLICY tenant_isolation ON public.cardapios
        AS PERMISSIVE FOR ALL TO PUBLIC
        USING ({_INITPLAN_TENANT_EXPR})
        WITH CHECK ({_INITPLAN_TENANT_EXPR})
        """
    )

    op.execute("DROP POLICY IF EXISTS contract_invites_select ON public.contract_invites")
    op.execute(
        f"""
        CREATE POLICY contract_invites_select ON public.contract_invites
        AS PERMISSIVE FOR SELECT TO PUBLIC
        USING ({_INITPLAN_TENANT_EXPR})
        """
    )

    op.execute("DROP POLICY IF EXISTS contract_invites_insert ON public.contract_invites")
    op.execute(
        f"""
        CREATE POLICY contract_invites_insert ON public.contract_invites
        AS PERMISSIVE FOR INSERT TO PUBLIC
        WITH CHECK ({_INITPLAN_TENANT_EXPR})
        """
    )

    op.execute("DROP POLICY IF EXISTS contract_invites_update ON public.contract_invites")
    op.execute(
        f"""
        CREATE POLICY contract_invites_update ON public.contract_invites
        AS PERMISSIVE FOR UPDATE TO PUBLIC
        USING ({_INITPLAN_TENANT_EXPR})
        WITH CHECK ({_INITPLAN_TENANT_EXPR})
        """
    )

    op.execute("DROP POLICY IF EXISTS tenant_isolation ON public.produto_familias")
    op.execute(
        f"""
        CREATE POLICY tenant_isolation ON public.produto_familias
        AS PERMISSIVE FOR ALL TO PUBLIC
        USING ({_INITPLAN_TENANT_EXPR})
        WITH CHECK ({_INITPLAN_TENANT_EXPR})
        """
    )

    op.execute(
        "DROP POLICY IF EXISTS tenant_isolation ON public.produto_familia_grupo_modificadores"
    )
    op.execute(
        f"""
        CREATE POLICY tenant_isolation ON public.produto_familia_grupo_modificadores
        AS PERMISSIVE FOR ALL TO PUBLIC
        USING ({_INITPLAN_TENANT_EXPR})
        WITH CHECK ({_INITPLAN_TENANT_EXPR})
        """
    )

    # 2. Align FORCE RLS and browser-role revocations on product family tables.
    op.execute("ALTER TABLE public.produto_familias FORCE ROW LEVEL SECURITY")
    op.execute(
        "ALTER TABLE public.produto_familia_grupo_modificadores FORCE ROW LEVEL SECURITY"
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
                REVOKE ALL ON TABLE public.produto_familias FROM anon;
                REVOKE ALL ON TABLE public.produto_familia_grupo_modificadores FROM anon;
            END IF;
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
                REVOKE ALL ON TABLE public.produto_familias FROM authenticated;
                REVOKE ALL ON TABLE public.produto_familia_grupo_modificadores FROM authenticated;
            END IF;
        END $$;
        """
    )

    # 3. Drop 3 strictly redundant indexes verified against live PG17 schema.
    op.execute("DROP INDEX IF EXISTS public.ix_contract_invites_token_hash")
    op.execute("DROP INDEX IF EXISTS public.ix_contract_invites_restaurante_id")
    op.execute("DROP INDEX IF EXISTS public.ix_cardapios_tenant")

    # 4. Add 5 hot-path indexes for 10-100+ restaurant scale.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_print_agent_tokens_token_hash
        ON public.print_agent_tokens (token_hash)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_comandas_tenant_open_delivery_status
        ON public.comandas (restaurante_id, delivery_status, criado_em)
        WHERE fechada = false
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_online_payment_intents_reconcile_due
        ON public.online_payment_intents (status, expires_at, created_at)
        WHERE status IN ('pending', 'in_process')
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_crm_contatos_tenant_criado
        ON public.crm_contatos_clientes (restaurante_id, criado_em DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_image_retirement_pending_due
        ON public.product_image_retirements (eligible_after)
        WHERE state = 'pending'
        """
    )


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return

    op.execute("SET LOCAL lock_timeout = '5s'")

    # Remove the 5 added hot-path indexes.
    op.execute("DROP INDEX IF EXISTS public.ix_image_retirement_pending_due")
    op.execute("DROP INDEX IF EXISTS public.ix_crm_contatos_tenant_criado")
    op.execute("DROP INDEX IF EXISTS public.ix_online_payment_intents_reconcile_due")
    op.execute("DROP INDEX IF EXISTS public.ix_comandas_tenant_open_delivery_status")
    op.execute("DROP INDEX IF EXISTS public.ix_print_agent_tokens_token_hash")

    # Recreate the 3 previously existing indexes.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_cardapios_tenant ON public.cardapios (restaurante_id)"
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_contract_invites_restaurante_id
        ON public.contract_invites (restaurante_id)
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS ix_contract_invites_token_hash
        ON public.contract_invites (token_hash)
        """
    )

    op.execute("ALTER TABLE public.produto_familias NO FORCE ROW LEVEL SECURITY")
    op.execute(
        "ALTER TABLE public.produto_familia_grupo_modificadores NO FORCE ROW LEVEL SECURITY"
    )

    # Restore previous policy expressions.
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON public.cardapios")
    op.execute(
        f"""
        CREATE POLICY tenant_isolation ON public.cardapios
        AS PERMISSIVE FOR ALL TO PUBLIC
        USING ({_LEGACY_TENANT_EXPR})
        WITH CHECK ({_LEGACY_TENANT_EXPR})
        """
    )
    op.execute("DROP POLICY IF EXISTS contract_invites_select ON public.contract_invites")
    op.execute(
        f"""
        CREATE POLICY contract_invites_select ON public.contract_invites
        AS PERMISSIVE FOR SELECT TO PUBLIC
        USING ({_LEGACY_TENANT_EXPR})
        """
    )
    op.execute("DROP POLICY IF EXISTS contract_invites_insert ON public.contract_invites")
    op.execute(
        f"""
        CREATE POLICY contract_invites_insert ON public.contract_invites
        AS PERMISSIVE FOR INSERT TO PUBLIC
        WITH CHECK ({_LEGACY_TENANT_EXPR})
        """
    )
    op.execute("DROP POLICY IF EXISTS contract_invites_update ON public.contract_invites")
    op.execute(
        f"""
        CREATE POLICY contract_invites_update ON public.contract_invites
        AS PERMISSIVE FOR UPDATE TO PUBLIC
        USING ({_LEGACY_TENANT_EXPR})
        WITH CHECK ({_LEGACY_TENANT_EXPR})
        """
    )
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON public.produto_familias")
    op.execute(
        f"""
        CREATE POLICY tenant_isolation ON public.produto_familias
        AS PERMISSIVE FOR ALL TO PUBLIC
        USING ({_LEGACY_TENANT_EXPR})
        WITH CHECK ({_LEGACY_TENANT_EXPR})
        """
    )
    op.execute(
        "DROP POLICY IF EXISTS tenant_isolation ON public.produto_familia_grupo_modificadores"
    )
    op.execute(
        f"""
        CREATE POLICY tenant_isolation ON public.produto_familia_grupo_modificadores
        AS PERMISSIVE FOR ALL TO PUBLIC
        USING ({_LEGACY_TENANT_EXPR})
        WITH CHECK ({_LEGACY_TENANT_EXPR})
        """
    )
