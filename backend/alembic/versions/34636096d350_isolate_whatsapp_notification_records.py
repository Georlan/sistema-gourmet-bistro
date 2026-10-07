"""prepare tenant resolution for signed WhatsApp callbacks

Revision ID: 34636096d350
Revises: f4a5b6c7d8e9
Create Date: 2026-10-07 02:06:06.465103

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '34636096d350'
down_revision: Union[str, Sequence[str], None] = 'f4a5b6c7d8e9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Prepare compatible callback resolution before enabling notification RLS."""
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute("""
        CREATE OR REPLACE FUNCTION koma_internal.lookup_whatsapp_notification(message_id text)
        RETURNS TABLE(id integer, restaurante_id integer)
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
        AS $function$
            SELECT min(n.id), min(n.restaurante_id)
            FROM public.notificacoes_whatsapp AS n
            WHERE n.wamid = message_id AND n.restaurante_id IS NOT NULL
            HAVING count(*) = 1
        $function$;
        REVOKE ALL ON FUNCTION koma_internal.lookup_whatsapp_notification(text) FROM PUBLIC;
        GRANT EXECUTE ON FUNCTION koma_internal.lookup_whatsapp_notification(text) TO koma_app;
    """)
    for role in ("anon", "authenticated"):
        if op.get_bind().execute(sa.text("SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :role)"), {"role": role}).scalar():
            op.execute(f"REVOKE ALL ON FUNCTION koma_internal.lookup_whatsapp_notification(text) FROM {role}")


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute("DROP FUNCTION IF EXISTS koma_internal.lookup_whatsapp_notification(text)")
