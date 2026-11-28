"""Decouple super_admin_audit_logs.restaurante_id FK from restaurantes.id.

Preserves append-only audit logs and No-Reuse tenant ID guarantees when an
authorized QA/sandbox tenant is purged from public.restaurantes.
"""

from __future__ import annotations

from alembic import op
from sqlalchemy import inspect

revision = "20261128scale1"
down_revision = "20261127b801"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name if bind is not None else ""

    if dialect == "postgresql":
        op.execute(
            """
            DO $$
            DECLARE
                fk_name text;
            BEGIN
                IF pg_catalog.to_regclass('public.super_admin_audit_logs') IS NULL THEN
                    RETURN;
                END IF;
                FOR fk_name IN
                    SELECT con.conname
                    FROM pg_constraint con
                    JOIN pg_class rel ON rel.oid = con.conrelid
                    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
                    JOIN pg_class ref ON ref.oid = con.confrelid
                    WHERE nsp.nspname = 'public'
                      AND rel.relname = 'super_admin_audit_logs'
                      AND con.contype = 'f'
                      AND ref.relname = 'restaurantes'
                LOOP
                    EXECUTE format(
                        'ALTER TABLE public.super_admin_audit_logs DROP CONSTRAINT IF EXISTS %I',
                        fk_name
                    );
                END LOOP;
            END $$;
            """
        )
        return

    inspector = inspect(bind)
    if "super_admin_audit_logs" not in set(inspector.get_table_names()):
        return
    fks = [
        fk
        for fk in inspector.get_foreign_keys("super_admin_audit_logs")
        if fk.get("referred_table") == "restaurantes" and fk.get("name")
    ]
    if fks:
        with op.batch_alter_table("super_admin_audit_logs") as batch_op:
            for fk in fks:
                batch_op.drop_constraint(fk["name"], type_="foreignkey")


def downgrade() -> None:
    # Registros de auditoria de tenants desprovisionados podem permanecer sem linha em restaurantes.
    pass
