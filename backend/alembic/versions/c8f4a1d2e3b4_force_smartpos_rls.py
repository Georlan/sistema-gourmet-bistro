"""force RLS on SmartPOS tenant tables and reassert runtime privileges

Revision ID: c8f4a1d2e3b4
Revises: a6c2e9f4b8d1
Create Date: 2026-08-18

As tabelas SmartPOS foram criadas depois do hardening global que aplicava
FORCE ROW LEVEL SECURITY. Além disso, tabelas criadas por migrations posteriores
aos grants globais podem não herdar os privilégios se o owner efetivo não for o
mesmo do ALTER DEFAULT PRIVILEGES. Este head reasserta o contrato do runtime no
schema atual, preservando `alembic_version` exclusivamente para migração.
"""

from typing import Sequence, Union

from alembic import op


revision: str = "c8f4a1d2e3b4"
down_revision: Union[str, Sequence[str], None] = "a6c2e9f4b8d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_TABLES = (
    "restaurante_capabilities",
    "smartpos_payment_intents",
)


def _reassert_runtime_privileges() -> None:
    # `koma_app` é a role de aplicação sem LOGIN/BYPASSRLS. O RLS continua
    # sendo a fronteira de dados; estes grants apenas permitem que o runtime
    # execute DML legítimo nas tabelas do produto. A tabela de controle do
    # Alembic permanece deliberadamente fora desse contrato.
    op.execute("GRANT USAGE ON SCHEMA public TO koma_app")
    op.execute("""
        DO $$
        DECLARE
            relation_name text;
        BEGIN
            FOR relation_name IN
                SELECT quote_ident(tablename)
                FROM pg_tables
                WHERE schemaname = 'public'
                  AND tablename <> 'alembic_version'
            LOOP
                EXECUTE format(
                    'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%s TO koma_app',
                    relation_name
                );
            END LOOP;
        END
        $$
    """)
    op.execute(
        "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO koma_app"
    )
    op.execute(
        "REVOKE ALL ON TABLE public.alembic_version FROM koma_app"
    )


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    for table in _TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")

    _reassert_runtime_privileges()


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    for table in _TABLES:
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
