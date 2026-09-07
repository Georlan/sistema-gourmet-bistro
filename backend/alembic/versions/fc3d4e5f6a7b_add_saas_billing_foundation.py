"""add saas billing foundation

Revision ID: fc3d4e5f6a7b
Revises: fb2c3d4e5f60
Create Date: 2026-09-07 01:40:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "fc3d4e5f6a7b"
down_revision = "fb2c3d4e5f60"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()

    # 1. Tabela global de intenção / setup de billing (pré-tenant)
    op.create_table(
        "saas_billing_setups",
        sa.Column("id", sa.String(length=36), primary_key=True, nullable=False),
        sa.Column("protocol", sa.String(length=64), nullable=False),
        sa.Column("contract_acceptance_id", sa.String(length=36), nullable=True),
        sa.Column("restaurante_id", sa.Integer(), nullable=True),
        sa.Column("provider", sa.String(length=32), nullable=False, server_default="mercado_pago"),
        sa.Column("payment_method_type", sa.String(length=32), nullable=False, server_default="credit_card"),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column("provider_customer_id", sa.String(length=100), nullable=True),
        sa.Column("provider_payment_method_reference", sa.String(length=100), nullable=True),
        sa.Column("provider_subscription_id", sa.String(length=100), nullable=True),
        sa.Column("billing_cycle", sa.String(length=16), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["contract_acceptance_id"],
            ["contract_acceptances.id"],
            name="fk_saas_billing_setups_contract_acceptance_id",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["restaurante_id"],
            ["restaurantes.id"],
            name="fk_saas_billing_setups_restaurante_id",
            ondelete="SET NULL",
        ),
        sa.UniqueConstraint("protocol", name="uq_saas_billing_setups_protocol"),
        sa.CheckConstraint("status IN ('pending', 'ready', 'failed', 'canceled')", name="ck_saas_billing_setups_status"),
        sa.CheckConstraint("provider IN ('mercado_pago')", name="ck_saas_billing_setups_provider"),
        sa.CheckConstraint("payment_method_type IN ('credit_card', 'pix')", name="ck_saas_billing_setups_payment_method"),
        sa.CheckConstraint("billing_cycle IS NULL OR billing_cycle IN ('monthly', 'annual', 'mensal', 'anual')", name="ck_saas_billing_setups_billing_cycle"),
    )
    op.create_index(
        "ix_saas_billing_setups_protocol",
        "saas_billing_setups",
        ["protocol"],
        unique=True,
    )
    op.create_index(
        "ix_saas_billing_setups_protocol_status",
        "saas_billing_setups",
        ["protocol", "status"],
        unique=False,
    )
    op.create_index(
        "ix_saas_billing_setups_contract_acceptance_id",
        "saas_billing_setups",
        ["contract_acceptance_id"],
        unique=False,
    )
    op.create_index(
        "ix_saas_billing_setups_restaurante_id",
        "saas_billing_setups",
        ["restaurante_id"],
        unique=False,
    )
    op.create_index(
        "uq_saas_billing_setups_provider_sub",
        "saas_billing_setups",
        ["provider", "provider_subscription_id"],
        unique=True,
        postgresql_where=sa.text("provider_subscription_id IS NOT NULL"),
        sqlite_where=sa.text("provider_subscription_id IS NOT NULL"),
    )

    # 2. Tabela canônica de assinaturas SaaS (tenant-scoped)
    op.create_table(
        "saas_subscriptions",
        sa.Column("id", sa.String(length=36), primary_key=True, nullable=False),
        sa.Column("restaurante_id", sa.Integer(), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False, server_default="mercado_pago"),
        sa.Column("provider_customer_id", sa.String(length=100), nullable=True),
        sa.Column("provider_subscription_id", sa.String(length=100), nullable=True),
        sa.Column("payment_method_type", sa.String(length=32), nullable=True),
        sa.Column("billing_cycle", sa.String(length=16), nullable=False, server_default="monthly"),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="trialing"),
        sa.Column("trial_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("trial_ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("current_period_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("current_period_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("grace_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["restaurante_id"],
            ["restaurantes.id"],
            name="fk_saas_subscriptions_restaurante_id",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("restaurante_id", name="uq_saas_subscriptions_restaurante_id"),
        sa.CheckConstraint("status IN ('trialing', 'active', 'past_due', 'canceled', 'suspended')", name="ck_saas_subscriptions_status"),
        sa.CheckConstraint("provider IN ('mercado_pago')", name="ck_saas_subscriptions_provider"),
        sa.CheckConstraint("billing_cycle IN ('monthly', 'annual', 'mensal', 'anual')", name="ck_saas_subscriptions_billing_cycle"),
        sa.CheckConstraint("payment_method_type IS NULL OR payment_method_type IN ('credit_card', 'pix')", name="ck_saas_subscriptions_payment_method"),
    )
    op.create_index(
        "ix_saas_subscriptions_restaurante_id",
        "saas_subscriptions",
        ["restaurante_id"],
        unique=True,
    )
    op.create_index(
        "ix_saas_subscriptions_status",
        "saas_subscriptions",
        ["status"],
        unique=False,
    )
    op.create_index(
        "uq_saas_subscriptions_provider_sub",
        "saas_subscriptions",
        ["provider", "provider_subscription_id"],
        unique=True,
        postgresql_where=sa.text("provider_subscription_id IS NOT NULL"),
        sqlite_where=sa.text("provider_subscription_id IS NOT NULL"),
    )

    # 3. Adiciona billing_mode em restaurantes (default legacy para os existentes)
    with op.batch_alter_table("restaurantes") as batch_op:
        batch_op.add_column(
            sa.Column("billing_mode", sa.String(length=20), server_default="subscription", nullable=False)
        )
        batch_op.create_check_constraint(
            "ck_restaurantes_billing_mode",
            "billing_mode IN ('subscription', 'legacy')",
        )
    op.execute("UPDATE restaurantes SET billing_mode = 'legacy'")

    if bind.dialect.name != "postgresql":
        return

    # 4. Permissions e RLS para PostgreSQL
    tenant_expr = (
        "restaurante_id = NULLIF("
        "current_setting('app.current_restaurante_id', true), ''"
        ")::integer"
    )

    op.execute("ALTER TABLE public.saas_subscriptions ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.saas_subscriptions FORCE ROW LEVEL SECURITY")

    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'koma_app') THEN
                -- Permissões em saas_billing_setups: ZERO permissões diretas concedidas a koma_app.
                -- O acesso ocorre exclusivamente via funções SECURITY DEFINER de koma_internal.
                REVOKE ALL ON TABLE public.saas_billing_setups FROM PUBLIC;
                REVOKE ALL ON TABLE public.saas_billing_setups FROM koma_app;

                -- Permissões em saas_subscriptions: isolamento estrito via RLS
                REVOKE ALL ON TABLE public.saas_subscriptions FROM PUBLIC;
                REVOKE ALL ON TABLE public.saas_subscriptions FROM koma_app;
                GRANT SELECT, INSERT, UPDATE ON TABLE public.saas_subscriptions TO koma_app;
            END IF;
        END
        $$;
    """)

    op.execute(f"""
        CREATE POLICY saas_subscriptions_select
        ON public.saas_subscriptions
        FOR SELECT
        TO koma_app
        USING ({tenant_expr})
    """)
    op.execute(f"""
        CREATE POLICY saas_subscriptions_insert
        ON public.saas_subscriptions
        FOR INSERT
        TO koma_app
        WITH CHECK ({tenant_expr})
    """)
    op.execute(f"""
        CREATE POLICY saas_subscriptions_update
        ON public.saas_subscriptions
        FOR UPDATE
        TO koma_app
        USING ({tenant_expr})
        WITH CHECK ({tenant_expr})
    """)

    # 5. Funções SECURITY DEFINER em koma_internal para leitura e controle de billing
    op.execute(
        """
        DROP FUNCTION IF EXISTS koma_internal.list_contract_acceptances_for_admin(integer);

        CREATE OR REPLACE FUNCTION koma_internal.list_contract_acceptances_for_admin(
            p_limit integer DEFAULT 100
        ) RETURNS TABLE(
            acceptance_id text,
            protocol text,
            accepted_at timestamptz,
            restaurant_name text,
            contracting_party_name text,
            contracting_party_tax_id_last4 text,
            representative_name text,
            representative_tax_id_last4 text,
            representative_role text,
            email text,
            phone text,
            plan text,
            billing_cycle text,
            fixed_monthly_price numeric,
            billing_amount numeric,
            annual_monthly_equivalent numeric,
            marketplace_rate numeric,
            legal_version text,
            terms_hash text,
            commercial_hash text,
            dpa_hash text,
            privacy_hash text,
            linked_restaurante_id integer,
            linked_at timestamptz,
            billing_status text,
            billing_provider text,
            payment_method_type text
        )
        LANGUAGE sql
        SECURITY DEFINER
        STABLE
        SET search_path = pg_catalog
        AS $$
            SELECT
                a.id::text,
                a.protocol::text,
                a.accepted_at,
                a.restaurant_name::text,
                a.contracting_party_name::text,
                a.contracting_party_tax_id_last4::text,
                a.representative_name::text,
                a.representative_tax_id_last4::text,
                a.representative_role::text,
                a.email::text,
                a.phone::text,
                a.plan::text,
                a.billing_cycle::text,
                a.fixed_monthly_price,
                a.billing_amount,
                a.annual_monthly_equivalent,
                a.marketplace_rate,
                a.legal_version::text,
                a.terms_hash::text,
                a.commercial_hash::text,
                a.dpa_hash::text,
                a.privacy_hash::text,
                link.restaurante_id,
                link.linked_at,
                COALESCE(bs.status, 'pending')::text AS billing_status,
                bs.provider::text AS billing_provider,
                bs.payment_method_type::text AS payment_method_type
            FROM public.contract_acceptances AS a
            LEFT JOIN public.restaurant_contract_acceptances AS link
              ON link.acceptance_id = a.id
            LEFT JOIN public.saas_billing_setups AS bs
              ON bs.protocol = a.protocol
            ORDER BY a.accepted_at DESC
            LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200)
        $$;
        REVOKE ALL ON FUNCTION koma_internal.list_contract_acceptances_for_admin(integer) FROM PUBLIC;
        GRANT EXECUTE ON FUNCTION koma_internal.list_contract_acceptances_for_admin(integer) TO koma_app;

        DROP FUNCTION IF EXISTS koma_internal.resolve_contract_acceptance_for_activation(text);

        CREATE OR REPLACE FUNCTION koma_internal.resolve_contract_acceptance_for_activation(
            p_protocol text
        ) RETURNS TABLE(
            acceptance_id text,
            protocol text,
            plan text,
            billing_cycle text,
            restaurant_name text,
            contracting_party_name text,
            representative_name text,
            email text,
            phone text,
            linked_restaurante_id integer,
            linked_at timestamptz,
            billing_status text,
            billing_provider text,
            payment_method_type text
        )
        LANGUAGE sql
        SECURITY DEFINER
        STABLE
        SET search_path = pg_catalog
        AS $$
            SELECT
                a.id::text,
                a.protocol::text,
                a.plan::text,
                a.billing_cycle::text,
                a.restaurant_name::text,
                a.contracting_party_name::text,
                a.representative_name::text,
                a.email::text,
                a.phone::text,
                link.restaurante_id,
                link.linked_at,
                COALESCE(bs.status, 'pending')::text AS billing_status,
                bs.provider::text AS billing_provider,
                bs.payment_method_type::text AS payment_method_type
            FROM public.contract_acceptances AS a
            LEFT JOIN public.restaurant_contract_acceptances AS link
              ON link.acceptance_id = a.id
            LEFT JOIN public.saas_billing_setups AS bs
              ON bs.protocol = a.protocol
            WHERE a.protocol = upper(btrim(COALESCE(p_protocol, '')))
            LIMIT 1
        $$;
        REVOKE ALL ON FUNCTION koma_internal.resolve_contract_acceptance_for_activation(text) FROM PUBLIC;
        GRANT EXECUTE ON FUNCTION koma_internal.resolve_contract_acceptance_for_activation(text) TO koma_app;

        -- Helper functions para saas_billing_setups (blindada contra SELECT/INSERT/UPDATE direto de koma_app)
        DROP FUNCTION IF EXISTS koma_internal.get_saas_billing_setup(text);

        CREATE OR REPLACE FUNCTION koma_internal.get_saas_billing_setup(
            p_protocol text
        ) RETURNS TABLE(
            id text,
            protocol text,
            contract_acceptance_id text,
            restaurante_id integer,
            provider text,
            payment_method_type text,
            status text,
            provider_customer_id text,
            provider_payment_method_reference text,
            provider_subscription_id text,
            billing_cycle text,
            created_at timestamptz,
            updated_at timestamptz
        )
        LANGUAGE sql
        SECURITY DEFINER
        STABLE
        SET search_path = pg_catalog
        AS $$
            SELECT
                s.id::text,
                s.protocol::text,
                s.contract_acceptance_id::text,
                s.restaurante_id,
                s.provider::text,
                s.payment_method_type::text,
                s.status::text,
                s.provider_customer_id::text,
                s.provider_payment_method_reference::text,
                s.provider_subscription_id::text,
                s.billing_cycle::text,
                s.created_at,
                s.updated_at
            FROM public.saas_billing_setups AS s
            WHERE s.protocol = upper(btrim(COALESCE(p_protocol, '')))
            LIMIT 1
        $$;
        REVOKE ALL ON FUNCTION koma_internal.get_saas_billing_setup(text) FROM PUBLIC;
        GRANT EXECUTE ON FUNCTION koma_internal.get_saas_billing_setup(text) TO koma_app;

        DROP FUNCTION IF EXISTS koma_internal.get_saas_billing_setup_by_provider_sub(text, text);

        CREATE OR REPLACE FUNCTION koma_internal.get_saas_billing_setup_by_provider_sub(
            p_provider text,
            p_sub_id text
        ) RETURNS TABLE(
            id text,
            protocol text,
            contract_acceptance_id text,
            restaurante_id integer,
            provider text,
            payment_method_type text,
            status text,
            provider_customer_id text,
            provider_payment_method_reference text,
            provider_subscription_id text,
            billing_cycle text,
            created_at timestamptz,
            updated_at timestamptz
        )
        LANGUAGE sql
        SECURITY DEFINER
        STABLE
        SET search_path = pg_catalog
        AS $$
            SELECT
                s.id::text,
                s.protocol::text,
                s.contract_acceptance_id::text,
                s.restaurante_id,
                s.provider::text,
                s.payment_method_type::text,
                s.status::text,
                s.provider_customer_id::text,
                s.provider_payment_method_reference::text,
                s.provider_subscription_id::text,
                s.billing_cycle::text,
                s.created_at,
                s.updated_at
            FROM public.saas_billing_setups AS s
            WHERE s.provider = p_provider
              AND s.provider_subscription_id = p_sub_id
            LIMIT 1
        $$;
        REVOKE ALL ON FUNCTION koma_internal.get_saas_billing_setup_by_provider_sub(text, text) FROM PUBLIC;
        GRANT EXECUTE ON FUNCTION koma_internal.get_saas_billing_setup_by_provider_sub(text, text) TO koma_app;

        DROP FUNCTION IF EXISTS koma_internal.link_saas_billing_setup_to_tenant(text, integer);

        CREATE OR REPLACE FUNCTION koma_internal.link_saas_billing_setup_to_tenant(
            p_protocol text,
            p_tenant_id integer
        ) RETURNS void
        LANGUAGE plpgsql
        SECURITY DEFINER
        VOLATILE
        SET search_path = pg_catalog
        AS $$
        BEGIN
            UPDATE public.saas_billing_setups
            SET restaurante_id = p_tenant_id,
                updated_at = clock_timestamp()
            WHERE protocol = upper(btrim(COALESCE(p_protocol, '')));
        END;
        $$;
        REVOKE ALL ON FUNCTION koma_internal.link_saas_billing_setup_to_tenant(text, integer) FROM PUBLIC;
        GRANT EXECUTE ON FUNCTION koma_internal.link_saas_billing_setup_to_tenant(text, integer) TO koma_app;

        DROP FUNCTION IF EXISTS koma_internal.upsert_saas_billing_setup(text, text, text, text, text, text, text, text, text);

        CREATE OR REPLACE FUNCTION koma_internal.upsert_saas_billing_setup(
            p_protocol text,
            p_contract_acceptance_id text,
            p_provider text,
            p_payment_method_type text,
            p_status text,
            p_provider_customer_id text,
            p_provider_payment_method_reference text,
            p_provider_subscription_id text,
            p_billing_cycle text
        ) RETURNS text
        LANGUAGE plpgsql
        SECURITY DEFINER
        VOLATILE
        SET search_path = pg_catalog
        AS $$
        DECLARE
            v_id text;
            v_clean_protocol text;
        BEGIN
            v_clean_protocol := upper(btrim(COALESCE(p_protocol, '')));
            
            INSERT INTO public.saas_billing_setups (
                id,
                protocol,
                contract_acceptance_id,
                provider,
                payment_method_type,
                status,
                provider_customer_id,
                provider_payment_method_reference,
                provider_subscription_id,
                billing_cycle,
                created_at,
                updated_at
            ) VALUES (
                gen_random_uuid()::text,
                v_clean_protocol,
                p_contract_acceptance_id,
                COALESCE(p_provider, 'mercado_pago'),
                COALESCE(p_payment_method_type, 'credit_card'),
                COALESCE(p_status, 'pending'),
                p_provider_customer_id,
                p_provider_payment_method_reference,
                p_provider_subscription_id,
                p_billing_cycle,
                clock_timestamp(),
                clock_timestamp()
            )
            ON CONFLICT (protocol) DO UPDATE SET
                contract_acceptance_id = COALESCE(EXCLUDED.contract_acceptance_id, public.saas_billing_setups.contract_acceptance_id),
                provider = EXCLUDED.provider,
                payment_method_type = EXCLUDED.payment_method_type,
                status = EXCLUDED.status,
                provider_customer_id = COALESCE(EXCLUDED.provider_customer_id, public.saas_billing_setups.provider_customer_id),
                provider_payment_method_reference = COALESCE(EXCLUDED.provider_payment_method_reference, public.saas_billing_setups.provider_payment_method_reference),
                provider_subscription_id = COALESCE(EXCLUDED.provider_subscription_id, public.saas_billing_setups.provider_subscription_id),
                billing_cycle = COALESCE(EXCLUDED.billing_cycle, public.saas_billing_setups.billing_cycle),
                updated_at = clock_timestamp()
            RETURNING id::text INTO v_id;

            RETURN v_id;
        END;
        $$;
        REVOKE ALL ON FUNCTION koma_internal.upsert_saas_billing_setup(text, text, text, text, text, text, text, text, text) FROM PUBLIC;
        GRANT EXECUTE ON FUNCTION koma_internal.upsert_saas_billing_setup(text, text, text, text, text, text, text, text, text) TO koma_app;
        """
    )


def downgrade() -> None:
    bind = op.get_bind()

    if bind.dialect.name == "postgresql":
        op.execute("DROP POLICY IF EXISTS saas_subscriptions_update ON public.saas_subscriptions")
        op.execute("DROP POLICY IF EXISTS saas_subscriptions_insert ON public.saas_subscriptions")
        op.execute("DROP POLICY IF EXISTS saas_subscriptions_select ON public.saas_subscriptions")

        op.execute("DROP FUNCTION IF EXISTS koma_internal.get_saas_billing_setup_by_provider_sub(text, text)")
        op.execute("DROP FUNCTION IF EXISTS koma_internal.upsert_saas_billing_setup(text, text, text, text, text, text, text, text, text)")
        op.execute("DROP FUNCTION IF EXISTS koma_internal.link_saas_billing_setup_to_tenant(text, integer)")
        op.execute("DROP FUNCTION IF EXISTS koma_internal.get_saas_billing_setup(text)")

        # Restaura a versão original de 11 colunas de resolve_contract_acceptance_for_activation (fb2c3d4e5f60)
        op.execute(
            """
            DROP FUNCTION IF EXISTS koma_internal.resolve_contract_acceptance_for_activation(text);

            CREATE OR REPLACE FUNCTION koma_internal.resolve_contract_acceptance_for_activation(
                p_protocol text
            ) RETURNS TABLE(
                acceptance_id text,
                protocol text,
                plan text,
                billing_cycle text,
                restaurant_name text,
                contracting_party_name text,
                representative_name text,
                email text,
                phone text,
                linked_restaurante_id integer,
                linked_at timestamptz
            )
            LANGUAGE sql
            SECURITY DEFINER
            STABLE
            SET search_path = pg_catalog
            AS $$
                SELECT
                    a.id::text,
                    a.protocol::text,
                    a.plan::text,
                    a.billing_cycle::text,
                    a.restaurant_name::text,
                    a.contracting_party_name::text,
                    a.representative_name::text,
                    a.email::text,
                    a.phone::text,
                    link.restaurante_id,
                    link.linked_at
                FROM public.contract_acceptances AS a
                LEFT JOIN public.restaurant_contract_acceptances AS link
                  ON link.acceptance_id = a.id
                WHERE a.protocol = upper(btrim(COALESCE(p_protocol, '')))
                LIMIT 1
            $$;
            REVOKE ALL ON FUNCTION koma_internal.resolve_contract_acceptance_for_activation(text) FROM PUBLIC;
            GRANT EXECUTE ON FUNCTION koma_internal.resolve_contract_acceptance_for_activation(text) TO koma_app;
            """
        )

        # Restaura a versão original de 24 colunas de list_contract_acceptances_for_admin (ea1b2c3d4e5f)
        op.execute(
            """
            DROP FUNCTION IF EXISTS koma_internal.list_contract_acceptances_for_admin(integer);

            CREATE OR REPLACE FUNCTION koma_internal.list_contract_acceptances_for_admin(
                p_limit integer DEFAULT 100
            ) RETURNS TABLE(
                acceptance_id text,
                protocol text,
                accepted_at timestamptz,
                restaurant_name text,
                contracting_party_name text,
                contracting_party_tax_id_last4 text,
                representative_name text,
                representative_tax_id_last4 text,
                representative_role text,
                email text,
                phone text,
                plan text,
                billing_cycle text,
                fixed_monthly_price numeric,
                billing_amount numeric,
                annual_monthly_equivalent numeric,
                marketplace_rate numeric,
                legal_version text,
                terms_hash text,
                commercial_hash text,
                dpa_hash text,
                privacy_hash text,
                linked_restaurante_id integer,
                linked_at timestamptz
            )
            LANGUAGE sql
            SECURITY DEFINER
            STABLE
            SET search_path = pg_catalog
            AS $$
                SELECT
                    a.id::text,
                    a.protocol::text,
                    a.accepted_at,
                    a.restaurant_name::text,
                    a.contracting_party_name::text,
                    a.contracting_party_tax_id_last4::text,
                    a.representative_name::text,
                    a.representative_tax_id_last4::text,
                    a.representative_role::text,
                    a.email::text,
                    a.phone::text,
                    a.plan::text,
                    a.billing_cycle::text,
                    a.fixed_monthly_price,
                    a.billing_amount,
                    a.annual_monthly_equivalent,
                    a.marketplace_rate,
                    a.legal_version::text,
                    a.terms_hash::text,
                    a.commercial_hash::text,
                    a.dpa_hash::text,
                    a.privacy_hash::text,
                    link.restaurante_id,
                    link.linked_at
                FROM public.contract_acceptances AS a
                LEFT JOIN public.restaurant_contract_acceptances AS link
                  ON link.acceptance_id = a.id
                ORDER BY a.accepted_at DESC
                LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200)
            $$;
            REVOKE ALL ON FUNCTION koma_internal.list_contract_acceptances_for_admin(integer) FROM PUBLIC;
            GRANT EXECUTE ON FUNCTION koma_internal.list_contract_acceptances_for_admin(integer) TO koma_app;
            """
        )

    op.drop_table("saas_subscriptions")
    op.drop_table("saas_billing_setups")

    with op.batch_alter_table("restaurantes") as batch_op:
        batch_op.drop_constraint("ck_restaurantes_billing_mode", type_="check")
        batch_op.drop_column("billing_mode")
