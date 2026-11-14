"""Allow explicit unpaid production release for direct Pix and optional bank reference.

Revision ID: c6a1d2e3f4b5
Revises: f4d9e1a3b5c7
"""
from alembic import op
import sqlalchemy as sa

revision = "c6a1d2e3f4b5"
down_revision = "f4d9e1a3b5c7"
branch_labels = None
depends_on = None

_OLD = "online_payment_status IS NULL OR online_payment_status IN ('pending', 'approved', 'rejected', 'cancelled', 'expired', 'error')"
_NEW = "online_payment_status IS NULL OR online_payment_status IN ('pending', 'pending_released', 'approved', 'rejected', 'cancelled', 'expired', 'error')"


def _replace_status_check(expression: str) -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TABLE comandas DROP CONSTRAINT ck_comandas_online_payment_status")
        # Do not scan active orders as part of the metadata change.
        op.execute("ALTER TABLE comandas ADD CONSTRAINT ck_comandas_online_payment_status CHECK (" + expression + ") NOT VALID")
    else:
        with op.batch_alter_table("comandas") as batch:
            batch.drop_constraint("ck_comandas_online_payment_status", type_="check")
            batch.create_check_constraint("ck_comandas_online_payment_status", expression)


def upgrade() -> None:
    _replace_status_check(_NEW)
    with op.batch_alter_table("direct_pix_receipts") as batch:
        batch.alter_column("bank_reference", existing_type=sa.String(length=32), existing_nullable=False, nullable=True)


def downgrade() -> None:
    # No false payment record may be introduced by a downgrade.
    bind = op.get_bind()
    if bind.execute(sa.text("SELECT 1 FROM comandas WHERE online_payment_status = 'pending_released' LIMIT 1")).first():
        raise RuntimeError("Resolve pending_released orders before downgrading direct Pix.")
    if bind.execute(sa.text("SELECT 1 FROM direct_pix_receipts WHERE bank_reference IS NULL LIMIT 1")).first():
        raise RuntimeError("Direct Pix manual receipts without bank IDs require retention; cannot downgrade.")
    with op.batch_alter_table("direct_pix_receipts") as batch:
        batch.alter_column("bank_reference", existing_type=sa.String(length=32), existing_nullable=True, nullable=False)
    _replace_status_check(_OLD)
