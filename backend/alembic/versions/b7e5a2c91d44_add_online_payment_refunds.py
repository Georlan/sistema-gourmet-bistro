"""add persistent Mercado Pago refund ledger

Revision ID: b7e5a2c91d44
Revises: dc8dcc280fff
Create Date: 2026-09-05 15:20:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "b7e5a2c91d44"
down_revision = "dc8dcc280fff"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "online_payment_refunds",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("restaurante_id", sa.Integer(), nullable=False),
        sa.Column("intent_id", sa.String(36), nullable=False),
        sa.Column("pagamento_id", sa.String(), nullable=False),
        sa.Column("estorno_id", sa.String(), nullable=True),
        sa.Column("provider", sa.String(32), nullable=False, server_default="mercado_pago"),
        sa.Column("external_payment_id", sa.String(128), nullable=False),
        sa.Column("external_refund_id", sa.String(128), nullable=True),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="requested"),
        sa.Column("provider_status", sa.String(32), nullable=True),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("provider_idempotency_key", sa.String(64), nullable=False),
        sa.Column("request_fingerprint", sa.String(64), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "provider IN ('mercado_pago')",
            name="ck_online_payment_refunds_provider",
        ),
        sa.CheckConstraint(
            "status IN ('requested','confirmed','failed')",
            name="ck_online_payment_refunds_status",
        ),
        sa.CheckConstraint("amount > 0", name="ck_online_payment_refunds_amount"),
        sa.ForeignKeyConstraint(
            ["restaurante_id"], ["restaurantes.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["intent_id"], ["online_payment_intents.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["pagamento_id"], ["pagamentos.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["estorno_id"], ["pagamento_estornos.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "restaurante_id",
            "idempotency_key",
            name="uq_online_payment_refunds_tenant_idempotency",
        ),
        sa.UniqueConstraint(
            "provider",
            "external_refund_id",
            name="uq_online_payment_refunds_provider_refund",
        ),
        sa.UniqueConstraint(
            "provider",
            "provider_idempotency_key",
            name="uq_online_payment_refunds_provider_idempotency",
        ),
        sa.UniqueConstraint(
            "restaurante_id",
            "estorno_id",
            name="uq_online_payment_refunds_tenant_estorno",
        ),
    )
    op.create_index(
        "ix_online_payment_refunds_restaurante_id",
        "online_payment_refunds",
        ["restaurante_id"],
    )
    op.create_index(
        "ix_online_payment_refunds_intent_id",
        "online_payment_refunds",
        ["intent_id"],
    )
    op.create_index(
        "ix_online_payment_refunds_pagamento_id",
        "online_payment_refunds",
        ["pagamento_id"],
    )
    op.create_index(
        "ix_online_payment_refunds_estorno_id",
        "online_payment_refunds",
        ["estorno_id"],
    )
    op.create_index(
        "ix_online_payment_refunds_tenant_payment_status",
        "online_payment_refunds",
        ["restaurante_id", "pagamento_id", "status", "created_at"],
    )

    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    tenant = "NULLIF((SELECT current_setting('app.current_restaurante_id', true)), '')::integer"
    op.execute("ALTER TABLE public.online_payment_refunds ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.online_payment_refunds FORCE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY tenant_isolation ON public.online_payment_refunds FOR ALL TO koma_app "
        f"USING (restaurante_id = {tenant}) WITH CHECK (restaurante_id = {tenant})"
    )
    op.execute(
        "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.online_payment_refunds TO koma_app"
    )

    # O webhook global pode chegar sem user_id. A função resolve apenas a conta
    # ativa associada a um payment_id já conhecido, sem expor dados do tenant.
    op.execute("""
        CREATE OR REPLACE FUNCTION koma_internal.resolve_mercado_pago_account_id_by_payment(
            p_payment_id text
        ) RETURNS text
        LANGUAGE sql
        SECURITY DEFINER
        STABLE
        SET search_path = pg_catalog
        AS $$
            SELECT a.id::text
            FROM public.online_payment_intents AS i
            JOIN public.restaurant_payment_accounts AS a
              ON a.restaurante_id = i.restaurante_id
             AND a.provider = 'mercado_pago'
             AND a.status = 'active'
            WHERE pg_has_role(session_user, 'koma_app', 'member')
              AND i.provider = 'mercado_pago'
              AND i.external_payment_id = btrim(COALESCE(p_payment_id, ''))
            LIMIT 1
        $$
    """)
    op.execute(
        "REVOKE ALL ON FUNCTION koma_internal.resolve_mercado_pago_account_id_by_payment(text) FROM PUBLIC"
    )
    op.execute(
        "GRANT EXECUTE ON FUNCTION koma_internal.resolve_mercado_pago_account_id_by_payment(text) TO koma_app"
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(
            "DROP FUNCTION IF EXISTS koma_internal.resolve_mercado_pago_account_id_by_payment(text)"
        )
    op.drop_index(
        "ix_online_payment_refunds_tenant_payment_status",
        table_name="online_payment_refunds",
    )
    op.drop_index("ix_online_payment_refunds_estorno_id", table_name="online_payment_refunds")
    op.drop_index("ix_online_payment_refunds_pagamento_id", table_name="online_payment_refunds")
    op.drop_index("ix_online_payment_refunds_intent_id", table_name="online_payment_refunds")
    op.drop_index(
        "ix_online_payment_refunds_restaurante_id",
        table_name="online_payment_refunds",
    )
    op.drop_table("online_payment_refunds")
