"""force RLS and add constrained pre-tenant authentication lookups

Revision ID: d5e6f7a8b9c0
Revises: c4d5e6f7a8b9
Create Date: 2026-07-22 23:15:00.000000

P0-02:
* força RLS inclusive para o proprietário das tabelas;
* mantém a role de runtime sem LOGIN/BYPASSRLS;
* fornece funções SECURITY DEFINER mínimas para descobrir o tenant durante
  login, ativação e autenticação do agente de impressão.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d5e6f7a8b9c0"
down_revision: Union[str, Sequence[str], None] = "c4d5e6f7a8b9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _tenant_tables(bind) -> list[str]:
    rows = bind.execute(sa.text("""
        SELECT DISTINCT table_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name = 'restaurante_id'
        ORDER BY table_name
    """))
    return [row[0] for row in rows]


def _quote(bind, identifier: str) -> str:
    return bind.dialect.identifier_preparer.quote(identifier)


def _replace_tenant_policy(bind, table: str) -> None:
    quoted = _quote(bind, table)
    op.execute(f"ALTER TABLE {quoted} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {quoted} FORCE ROW LEVEL SECURITY")
    op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {quoted}")
    op.execute(f"""
        CREATE POLICY tenant_isolation ON {quoted}
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
    if bind.dialect.name != "postgresql":
        return

    op.execute("ALTER ROLE koma_app WITH NOLOGIN NOBYPASSRLS")
    op.execute("GRANT USAGE ON SCHEMA public TO koma_app")
    op.execute(
        "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO koma_app"
    )
    op.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO koma_app")

    op.execute("ALTER TABLE restaurantes ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE restaurantes FORCE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON restaurantes")
    op.execute("""
        CREATE POLICY tenant_isolation ON restaurantes
        USING (
            id = NULLIF(
                current_setting('app.current_restaurante_id', true), ''
            )::integer
        )
        WITH CHECK (
            id = NULLIF(
                current_setting('app.current_restaurante_id', true), ''
            )::integer
        )
    """)

    for table in _tenant_tables(bind):
        _replace_tenant_policy(bind, table)

    # Funções de bootstrap ficam fora do schema exposto pelo PostgREST. Elas
    # retornam apenas id/tenant/hash e não são executáveis por PUBLIC.
    op.execute("CREATE SCHEMA IF NOT EXISTS koma_internal")
    op.execute("REVOKE ALL ON SCHEMA koma_internal FROM PUBLIC")
    op.execute("GRANT USAGE ON SCHEMA koma_internal TO koma_app")

    op.execute("""
        CREATE OR REPLACE FUNCTION koma_internal.auth_user(p_identifier text)
        RETURNS TABLE (
            id text,
            restaurante_id integer,
            senha_hash text
        )
        LANGUAGE sql
        SECURITY DEFINER
        STABLE
        SET search_path = pg_catalog
        AS $$
            SELECT u.id::text, u.restaurante_id, u.senha_hash::text
            FROM public.usuarios AS u
            WHERE lower(COALESCE(u.email, '')) = lower(btrim(p_identifier))
               OR lower(COALESCE(u.telefone, '')) = lower(btrim(p_identifier))
               OR lower(COALESCE(u.usuario, '')) = lower(btrim(p_identifier))
            LIMIT 1
        $$
    """)
    op.execute("REVOKE ALL ON FUNCTION koma_internal.auth_user(text) FROM PUBLIC")
    op.execute("GRANT EXECUTE ON FUNCTION koma_internal.auth_user(text) TO koma_app")

    op.execute("""
        CREATE OR REPLACE FUNCTION koma_internal.auth_invite(p_token text)
        RETURNS TABLE (id text, restaurante_id integer)
        LANGUAGE sql
        SECURITY DEFINER
        STABLE
        SET search_path = pg_catalog
        AS $$
            SELECT u.id::text, u.restaurante_id
            FROM public.usuarios AS u
            WHERE u.token_convite::text = btrim(p_token)
            LIMIT 1
        $$
    """)
    op.execute("REVOKE ALL ON FUNCTION koma_internal.auth_invite(text) FROM PUBLIC")
    op.execute("GRANT EXECUTE ON FUNCTION koma_internal.auth_invite(text) TO koma_app")

    op.execute("""
        CREATE OR REPLACE FUNCTION koma_internal.auth_print_agent(p_token_hash text)
        RETURNS TABLE (id text, restaurante_id integer)
        LANGUAGE sql
        SECURITY DEFINER
        STABLE
        SET search_path = pg_catalog
        AS $$
            SELECT a.id::text, a.restaurante_id
            FROM public.print_agent_tokens AS a
            WHERE a.token_hash = btrim(p_token_hash)
              AND a.ativo IS TRUE
            LIMIT 1
        $$
    """)
    op.execute(
        "REVOKE ALL ON FUNCTION koma_internal.auth_print_agent(text) FROM PUBLIC"
    )
    op.execute(
        "GRANT EXECUTE ON FUNCTION koma_internal.auth_print_agent(text) TO koma_app"
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    op.execute("DROP FUNCTION IF EXISTS koma_internal.auth_print_agent(text)")
    op.execute("DROP FUNCTION IF EXISTS koma_internal.auth_invite(text)")
    op.execute("DROP FUNCTION IF EXISTS koma_internal.auth_user(text)")
    op.execute("DROP SCHEMA IF EXISTS koma_internal")
    op.execute("ALTER TABLE restaurantes NO FORCE ROW LEVEL SECURITY")
    for table in _tenant_tables(bind):
        op.execute(
            f"ALTER TABLE {_quote(bind, table)} NO FORCE ROW LEVEL SECURITY"
        )
