"""disambiguate_multitenant_login

Revision ID: e8f9a0b1c2d3
Revises: d6e7f8a9b0c1
Create Date: 2026-08-14 00:45:00.000000
"""

from typing import Sequence, Union

from alembic import op


revision: str = "e8f9a0b1c2d3"
down_revision: Union[str, Sequence[str], None] = "d6e7f8a9b0c1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE OR REPLACE FUNCTION koma_internal.auth_user_candidates(
            p_identifier text,
            p_restaurante_id integer DEFAULT NULL
        )
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
            WHERE (
                    lower(COALESCE(u.email, '')) = lower(btrim(p_identifier))
                 OR lower(COALESCE(u.telefone, '')) = lower(btrim(p_identifier))
                 OR lower(COALESCE(u.usuario, '')) = lower(btrim(p_identifier))
            )
              AND (p_restaurante_id IS NULL OR u.restaurante_id = p_restaurante_id)
            ORDER BY u.restaurante_id, u.id
            LIMIT 10
        $$
        """
    )
    op.execute(
        "REVOKE ALL ON FUNCTION "
        "koma_internal.auth_user_candidates(text, integer) FROM PUBLIC"
    )
    op.execute(
        "GRANT EXECUTE ON FUNCTION "
        "koma_internal.auth_user_candidates(text, integer) TO koma_app"
    )


def downgrade() -> None:
    op.execute(
        "DROP FUNCTION IF EXISTS "
        "koma_internal.auth_user_candidates(text, integer)"
    )
