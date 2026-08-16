"""force row level security on remaining tenant tables

Revision ID: a0b1c2d3e4f5
Revises: f9a0b1c2d3e4
Create Date: 2026-08-16 09:30:00.000000

Fecha a diferença entre ENABLE RLS e FORCE RLS nas tabelas criadas pelas
etapas mais recentes. As políticas tenant_isolation existentes são preservadas.
Também fornece um lookup mínimo para o cliente consultar apenas um pedido cujo
id + chave de idempotência ele realmente conhece, antes de o RLS saber o tenant.
"""
from typing import Sequence, Union

from alembic import op


revision: str = "a0b1c2d3e4f5"
down_revision: Union[str, Sequence[str], None] = "f9a0b1c2d3e4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TENANT_TABLES = (
    "numeradores_operacionais",
    "atendimentos_mesa",
    "atendimento_comandas",
    "lancamento_identidades",
    "movimentos_atendimento",
    "motoboy_tokens_ativos",
)


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    for table in TENANT_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")

    # A rota pública de acompanhamento nasce sem JWT e portanto sem tenant.
    # Ela só pode descobrir o restaurante quando conhece simultaneamente o ID
    # técnico do pedido e a chave aleatória criada pelo mesmo navegador. O
    # retorno mínimo (apenas restaurante_id) é usado para fixar o RLS antes de
    # qualquer leitura da comanda/itens.
    op.execute("""
        CREATE OR REPLACE FUNCTION koma_internal.resolve_public_order_tenant(
            p_comanda_id text,
            p_key text
        )
        RETURNS integer
        LANGUAGE sql
        SECURITY DEFINER
        STABLE
        SET search_path = pg_catalog
        AS $$
            SELECT c.restaurante_id
            FROM public.comandas AS c
            WHERE pg_has_role(session_user, 'koma_app', 'member')
              AND btrim(COALESCE(p_comanda_id, '')) <> ''
              AND btrim(COALESCE(p_key, '')) <> ''
              AND c.id::text = btrim(p_comanda_id)
              AND c.idempotency_key::text = btrim(p_key)
            LIMIT 1
        $$
    """)
    op.execute(
        "REVOKE ALL ON FUNCTION "
        "koma_internal.resolve_public_order_tenant(text, text) FROM PUBLIC"
    )
    op.execute(
        "GRANT EXECUTE ON FUNCTION "
        "koma_internal.resolve_public_order_tenant(text, text) TO koma_app"
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    op.execute(
        "DROP FUNCTION IF EXISTS "
        "koma_internal.resolve_public_order_tenant(text, text)"
    )
    for table in TENANT_TABLES:
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
