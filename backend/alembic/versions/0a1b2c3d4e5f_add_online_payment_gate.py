"""add provider-neutral online payment gate

Revision ID: 0a1b2c3d4e5f
Revises: f6b2c3d4e5f6
Create Date: 2026-09-01 10:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0a1b2c3d4e5f"
down_revision = "f6b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("comandas") as batch_op:
        batch_op.add_column(sa.Column("online_payment_status", sa.String(20), nullable=True))
        batch_op.create_check_constraint(
            "ck_comandas_online_payment_status",
            "online_payment_status IS NULL OR online_payment_status IN "
            "('pending','approved','rejected','cancelled','expired','error')",
        )
        batch_op.create_index(
            "ix_comandas_online_payment_gate",
            ["restaurante_id", "online_payment_status", "criado_em"],
            unique=False,
        )

    op.create_table(
        "restaurant_payment_accounts",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("restaurante_id", sa.Integer(), nullable=False),
        sa.Column("provider", sa.String(32), nullable=False),
        sa.Column("provider_user_id", sa.String(128), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
        sa.Column("access_token", sa.Text(), nullable=False),
        sa.Column("refresh_token", sa.Text(), nullable=True),
        sa.Column("webhook_secret", sa.Text(), nullable=False),
        sa.Column("public_key", sa.String(255), nullable=True),
        sa.Column("token_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("provider IN ('mercado_pago')", name="ck_payment_accounts_provider"),
        sa.CheckConstraint("status IN ('active','disconnected','error')", name="ck_payment_accounts_status"),
        sa.ForeignKeyConstraint(["restaurante_id"], ["restaurantes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("restaurante_id", "provider", name="uq_payment_accounts_tenant_provider"),
        sa.UniqueConstraint("provider", "provider_user_id", name="uq_payment_accounts_provider_user"),
    )
    op.create_index("ix_restaurant_payment_accounts_restaurante_id", "restaurant_payment_accounts", ["restaurante_id"])

    op.create_table(
        "online_payment_intents",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("restaurante_id", sa.Integer(), nullable=False),
        sa.Column("comanda_id", sa.String(), nullable=False),
        sa.Column("turno_id", sa.Integer(), nullable=False),
        sa.Column("pagamento_id", sa.String(), nullable=True),
        sa.Column("provider", sa.String(32), nullable=False),
        sa.Column("method", sa.String(32), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="created"),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("marketplace_fee", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("external_payment_id", sa.String(128), nullable=True),
        sa.Column("qr_code", sa.Text(), nullable=True),
        sa.Column("qr_code_base64", sa.Text(), nullable=True),
        sa.Column("ticket_url", sa.Text(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.CheckConstraint("provider IN ('mercado_pago')", name="ck_online_payment_intents_provider"),
        sa.CheckConstraint("method IN ('pix','cartao_credito','cartao_debito')", name="ck_online_payment_intents_method"),
        sa.CheckConstraint("status IN ('created','pending','approved','rejected','cancelled','expired','error')", name="ck_online_payment_intents_status"),
        sa.CheckConstraint("amount > 0", name="ck_online_payment_intents_amount"),
        sa.CheckConstraint("marketplace_fee >= 0 AND marketplace_fee <= amount", name="ck_online_payment_intents_marketplace_fee"),
        sa.ForeignKeyConstraint(["restaurante_id"], ["restaurantes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["comanda_id"], ["comandas.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["turno_id"], ["caixa_turnos.id"]),
        sa.ForeignKeyConstraint(["pagamento_id"], ["pagamentos.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("restaurante_id", "comanda_id", name="uq_online_payment_intents_tenant_order"),
        sa.UniqueConstraint("restaurante_id", "idempotency_key", name="uq_online_payment_intents_tenant_idempotency"),
        sa.UniqueConstraint("provider", "external_payment_id", name="uq_online_payment_intents_provider_payment"),
    )
    op.create_index("ix_online_payment_intents_comanda_id", "online_payment_intents", ["comanda_id"])
    op.create_index("ix_online_payment_intents_restaurante_id", "online_payment_intents", ["restaurante_id"])
    op.create_index("ix_online_payment_intents_tenant_status", "online_payment_intents", ["restaurante_id", "status", "created_at"])

    op.create_table(
        "online_payment_webhook_events",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("restaurante_id", sa.Integer(), nullable=False),
        sa.Column("provider", sa.String(32), nullable=False),
        sa.Column("request_id", sa.String(128), nullable=False),
        sa.Column("external_payment_id", sa.String(128), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="received"),
        sa.Column("raw_payload", sa.JSON(), nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.CheckConstraint("provider IN ('mercado_pago')", name="ck_online_payment_webhook_events_provider"),
        sa.CheckConstraint("status IN ('received','processed','ignored','failed')", name="ck_online_payment_webhook_events_status"),
        sa.ForeignKeyConstraint(["restaurante_id"], ["restaurantes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("provider", "request_id", name="uq_online_payment_webhook_events_request"),
    )
    op.create_index("ix_online_payment_webhook_events_restaurante_id", "online_payment_webhook_events", ["restaurante_id"])
    op.create_index("ix_online_payment_webhook_tenant_payment", "online_payment_webhook_events", ["restaurante_id", "external_payment_id"])

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        tenant = "NULLIF((SELECT current_setting('app.current_restaurante_id', true)), '')::integer"
        for table in ("restaurant_payment_accounts", "online_payment_intents", "online_payment_webhook_events"):
            op.execute(f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY")
            op.execute(f"ALTER TABLE public.{table} FORCE ROW LEVEL SECURITY")
            op.execute(
                f"CREATE POLICY tenant_isolation ON public.{table} FOR ALL TO koma_app "
                f"USING (restaurante_id = {tenant}) WITH CHECK (restaurante_id = {tenant})"
            )
            op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.{table} TO koma_app")

        op.execute("""
            CREATE OR REPLACE FUNCTION koma_internal.resolve_payment_account_tenant(p_account_id text)
            RETURNS integer LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog AS $$
                SELECT a.restaurante_id FROM public.restaurant_payment_accounts AS a
                WHERE pg_has_role(session_user, 'koma_app', 'member')
                  AND a.id::text = btrim(COALESCE(p_account_id, ''))
                  AND a.status = 'active' LIMIT 1
            $$
        """)
        op.execute("REVOKE ALL ON FUNCTION koma_internal.resolve_payment_account_tenant(text) FROM PUBLIC")
        op.execute("GRANT EXECUTE ON FUNCTION koma_internal.resolve_payment_account_tenant(text) TO koma_app")


def downgrade():
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("DROP FUNCTION IF EXISTS koma_internal.resolve_payment_account_tenant(text)")
    op.drop_index("ix_online_payment_webhook_tenant_payment", table_name="online_payment_webhook_events")
    op.drop_index("ix_online_payment_webhook_events_restaurante_id", table_name="online_payment_webhook_events")
    op.drop_table("online_payment_webhook_events")
    op.drop_index("ix_online_payment_intents_tenant_status", table_name="online_payment_intents")
    op.drop_index("ix_online_payment_intents_restaurante_id", table_name="online_payment_intents")
    op.drop_index("ix_online_payment_intents_comanda_id", table_name="online_payment_intents")
    op.drop_table("online_payment_intents")
    op.drop_index("ix_restaurant_payment_accounts_restaurante_id", table_name="restaurant_payment_accounts")
    op.drop_table("restaurant_payment_accounts")
    with op.batch_alter_table("comandas") as batch_op:
        batch_op.drop_index("ix_comandas_online_payment_gate")
        batch_op.drop_constraint("ck_comandas_online_payment_status", type_="check")
        batch_op.drop_column("online_payment_status")
