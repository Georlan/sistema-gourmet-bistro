"""notify print agents after durable queue changes

Revision ID: d9e0f1a2b3c4
Revises: c8d1e2f3a4b5
Create Date: 2026-09-05 22:30:00.000000
"""

from alembic import op


revision = "d9e0f1a2b3c4"
down_revision = "c8d1e2f3a4b5"
branch_labels = None
depends_on = None


CHANNEL = "koma_print_jobs"
FUNCTION = "koma_internal.notify_print_job_pending"
TRIGGER = "trg_print_jobs_notify_pending"


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION {FUNCTION}()
        RETURNS trigger
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = pg_catalog
        AS $$
        BEGIN
            IF NEW.status <> 'pending' THEN
                RETURN NEW;
            END IF;

            IF TG_OP = 'INSERT' THEN
                PERFORM pg_notify('{CHANNEL}', NEW.restaurante_id::text);
            ELSIF OLD.status IS DISTINCT FROM 'pending' THEN
                PERFORM pg_notify('{CHANNEL}', NEW.restaurante_id::text);
            END IF;
            RETURN NEW;
        END;
        $$
        """
    )
    op.execute(f"REVOKE ALL ON FUNCTION {FUNCTION}() FROM PUBLIC")
    op.execute(f"DROP TRIGGER IF EXISTS {TRIGGER} ON public.print_jobs")
    op.execute(
        f"""
        CREATE TRIGGER {TRIGGER}
        AFTER INSERT OR UPDATE OF status ON public.print_jobs
        FOR EACH ROW
        EXECUTE FUNCTION {FUNCTION}()
        """
    )
    op.execute(
        "COMMENT ON TRIGGER "
        f"{TRIGGER} ON public.print_jobs IS "
        "'Wake-up hint only; PrintJob remains the durable source of truth.'"
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    op.execute(f"DROP TRIGGER IF EXISTS {TRIGGER} ON public.print_jobs")
    op.execute(f"DROP FUNCTION IF EXISTS {FUNCTION}()")
