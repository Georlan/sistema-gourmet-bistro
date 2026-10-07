"""enforce notification tenant RLS and remove obsolete browser table grants

Revision ID: 47a6b7c8d9e0
Revises: 34636096d350
"""
from alembic import op
import sqlalchemy as sa

revision = "47a6b7c8d9e0"
down_revision = "34636096d350"
branch_labels = None
depends_on = None


def upgrade():
    if op.get_bind().dialect.name != "postgresql":
        return
    # Fail the new deploy instead of waiting indefinitely on live operations.
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute("ALTER TABLE public.notificacoes_whatsapp ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.notificacoes_whatsapp FORCE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON public.notificacoes_whatsapp")
    op.execute("""
        CREATE POLICY tenant_isolation ON public.notificacoes_whatsapp
        FOR ALL TO koma_app
        USING (restaurante_id = NULLIF((SELECT current_setting('app.current_restaurante_id', true)), '')::integer)
        WITH CHECK (restaurante_id = NULLIF((SELECT current_setting('app.current_restaurante_id', true)), '')::integer)
    """)
    for role in ("anon", "authenticated"):
        if op.get_bind().execute(sa.text("SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=:role)"), {"role": role}).scalar():
            for table in ("notificacoes_whatsapp", "restaurantes", "categorias", "produtos"):
                op.execute(f"REVOKE ALL ON TABLE public.{table} FROM {role}")


def downgrade():
    # Security repair is monotonic: never reopen cross-tenant/browser access.
    # Backend rollback must retain the compatible callback implementation.
    pass
