"""secure public cardapio, OTP, rate limits and order idempotency

Revision ID: e6f7a8b9c0d1
Revises: d5e6f7a8b9c0
Create Date: 2026-07-23 00:45:00.000000

P0-06:
* remove acesso direto de anon/authenticated às tabelas da aplicação;
* persiste somente hashes de OTP em tabela compartilhada e isolada por tenant;
* persiste limites de requisição públicos por tenant;
* adiciona idempotência composta aos pedidos do cardápio;
* fornece lookups mínimos de restaurantes públicos somente ao backend.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e6f7a8b9c0d1"
down_revision: Union[str, Sequence[str], None] = "d5e6f7a8b9c0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _secure_new_tenant_table(table: str) -> None:
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
    op.execute(f"""
        CREATE POLICY tenant_isolation ON {table}
        USING (
            restaurante_id = NULLIF(
                current_setting('app.current_restaurante_id', true), ''
            )::integer
        )
        WITH CHECK (
            restaurante_id = NULLIF(
                current_setting('app.current_restaurante_id', true), ''
            )::integer
        )
    """)


def upgrade() -> None:
    bind = op.get_bind()

    if bind.dialect.name == "postgresql":
        # Recriar comandas em batch tenta remover sua PK e quebra todas as FKs
        # externas. No PostgreSQL, estas alterações são suportadas diretamente.
        op.add_column(
            "comandas",
            sa.Column("idempotency_key", sa.String(length=128), nullable=True)
        )
        op.create_index(
            "ix_comandas_idempotency_key",
            "comandas",
            ["idempotency_key"],
            unique=False,
        )
        op.create_unique_constraint(
            "uq_comandas_restaurante_idempotency",
            "comandas",
            ["restaurante_id", "idempotency_key"],
        )
    else:
        with op.batch_alter_table("comandas") as batch_op:
            batch_op.add_column(
                sa.Column("idempotency_key", sa.String(length=128), nullable=True)
            )
            batch_op.create_index(
                "ix_comandas_idempotency_key",
                ["idempotency_key"],
                unique=False,
            )
            batch_op.create_unique_constraint(
                "uq_comandas_restaurante_idempotency",
                ["restaurante_id", "idempotency_key"],
            )

    op.create_table(
        "otp_challenges",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("restaurante_id", sa.Integer(), nullable=False),
        sa.Column("telefone_hash", sa.String(length=64), nullable=False),
        sa.Column("otp_hash", sa.String(length=64), nullable=False),
        sa.Column("expira_em", sa.DateTime(timezone=True), nullable=False),
        sa.Column("tentativas", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("ultimo_envio_em", sa.DateTime(timezone=True), nullable=False),
        sa.Column("janela_iniciada_em", sa.DateTime(timezone=True), nullable=False),
        sa.Column("envios_na_janela", sa.Integer(), nullable=False, server_default="1"),
        sa.ForeignKeyConstraint(
            ["restaurante_id"], ["restaurantes.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "restaurante_id",
            "telefone_hash",
            name="uq_otp_challenges_restaurante_telefone",
        ),
    )
    op.create_index(
        "ix_otp_challenges_restaurante_id",
        "otp_challenges",
        ["restaurante_id"],
        unique=False,
    )

    op.create_table(
        "public_rate_limits",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("restaurante_id", sa.Integer(), nullable=False),
        sa.Column("scope", sa.String(length=50), nullable=False),
        sa.Column("key_hash", sa.String(length=64), nullable=False),
        sa.Column("janela_iniciada_em", sa.DateTime(timezone=True), nullable=False),
        sa.Column("requisicoes", sa.Integer(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(
            ["restaurante_id"], ["restaurantes.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "restaurante_id",
            "scope",
            "key_hash",
            name="uq_public_rate_limits_tenant_scope_key",
        ),
    )
    op.create_index(
        "ix_public_rate_limits_restaurante_id",
        "public_rate_limits",
        ["restaurante_id"],
        unique=False,
    )

    if bind.dialect.name != "postgresql":
        return

    for table in ("otp_challenges", "public_rate_limits"):
        op.execute(
            f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE {table} TO koma_app"
        )
        _secure_new_tenant_table(table)
    op.execute(
        "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO koma_app"
    )

    # O navegador não acessa mais as tabelas da aplicação via Data API. O
    # backend usa a role dedicada koma_app e devolve somente DTOs públicos.
    op.execute("""
        DO $$
        DECLARE table_name text;
        BEGIN
            FOR table_name IN
                SELECT DISTINCT c.table_name
                FROM information_schema.columns c
                WHERE c.table_schema = 'public'
                  AND c.column_name = 'restaurante_id'
                UNION SELECT 'restaurantes'
            LOOP
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
                    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', table_name);
                END IF;
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
                    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', table_name);
                END IF;
            END LOOP;
        END
        $$
    """)
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
                REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
            END IF;
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
                REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
            END IF;
        END
        $$
    """)
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
                EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM anon';
                EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE USAGE, SELECT, UPDATE ON SEQUENCES FROM anon';
            END IF;
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
                EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM authenticated';
                EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE USAGE, SELECT, UPDATE ON SEQUENCES FROM authenticated';
            END IF;
        END
        $$
    """)

    op.execute("""
        CREATE OR REPLACE FUNCTION koma_internal.resolve_public_restaurant(
            p_identifier text
        )
        RETURNS TABLE (id integer)
        LANGUAGE sql
        SECURITY DEFINER
        STABLE
        SET search_path = pg_catalog
        AS $$
            SELECT r.id
            FROM public.restaurantes AS r
            WHERE pg_has_role(session_user, 'koma_app', 'member')
              AND (
                  r.id::text = btrim(p_identifier)
                  OR lower(COALESCE(r.slug, '')) = lower(btrim(p_identifier))
              )
            ORDER BY CASE WHEN r.id::text = btrim(p_identifier) THEN 0 ELSE 1 END
            LIMIT 1
        $$
    """)
    op.execute(
        "REVOKE ALL ON FUNCTION "
        "koma_internal.resolve_public_restaurant(text) FROM PUBLIC"
    )
    op.execute(
        "GRANT EXECUTE ON FUNCTION "
        "koma_internal.resolve_public_restaurant(text) TO koma_app"
    )

    op.execute("""
        CREATE OR REPLACE FUNCTION koma_internal.list_public_restaurants()
        RETURNS TABLE (
            id integer,
            slug text,
            nome text,
            logo_url text,
            subtitulo text
        )
        LANGUAGE sql
        SECURITY DEFINER
        STABLE
        SET search_path = pg_catalog
        AS $$
            SELECT
                r.id,
                r.slug::text,
                r.nome::text,
                r.logo_url::text,
                r.subtitulo::text
            FROM public.restaurantes AS r
            WHERE pg_has_role(session_user, 'koma_app', 'member')
            ORDER BY r.nome
        $$
    """)
    op.execute(
        "REVOKE ALL ON FUNCTION "
        "koma_internal.list_public_restaurants() FROM PUBLIC"
    )
    op.execute(
        "GRANT EXECUTE ON FUNCTION "
        "koma_internal.list_public_restaurants() TO koma_app"
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(
            "DROP FUNCTION IF EXISTS "
            "koma_internal.list_public_restaurants()"
        )
        op.execute(
            "DROP FUNCTION IF EXISTS "
            "koma_internal.resolve_public_restaurant(text)"
        )
        for table in ("public_rate_limits", "otp_challenges"):
            op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")

    op.drop_index(
        "ix_public_rate_limits_restaurante_id",
        table_name="public_rate_limits",
    )
    op.drop_table("public_rate_limits")
    op.drop_index(
        "ix_otp_challenges_restaurante_id",
        table_name="otp_challenges",
    )
    op.drop_table("otp_challenges")

    with op.batch_alter_table("comandas") as batch_op:
        batch_op.drop_constraint(
            "uq_comandas_restaurante_idempotency", type_="unique"
        )
        batch_op.drop_index("ix_comandas_idempotency_key")
        batch_op.drop_column("idempotency_key")
