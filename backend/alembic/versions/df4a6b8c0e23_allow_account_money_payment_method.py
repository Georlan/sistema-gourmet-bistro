"""allow account_money payment method

Revision ID: df4a6b8c0e23
Revises: ce3f5a7b9d12
Create Date: 2026-09-13 14:15:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "df4a6b8c0e23"
down_revision = "ce3f5a7b9d12"
branch_labels = None
depends_on = None

NEW_SETUPS_SQL = "payment_method_type IN ('credit_card', 'pix', 'pix_automatic', 'account_money')"
OLD_SETUPS_SQL = "payment_method_type IN ('credit_card', 'pix', 'pix_automatic')"

NEW_SUBS_SQL = "payment_method_type IS NULL OR payment_method_type IN ('credit_card', 'pix', 'pix_automatic', 'account_money')"
OLD_SUBS_SQL = "payment_method_type IS NULL OR payment_method_type IN ('credit_card', 'pix', 'pix_automatic')"


def upgrade() -> None:
    dialect = op.get_bind().dialect.name
    if dialect == "sqlite":
        with op.batch_alter_table("saas_billing_setups") as batch_op:
            batch_op.drop_constraint("ck_saas_billing_setups_payment_method", type_="check")
            batch_op.create_check_constraint(
                "ck_saas_billing_setups_payment_method",
                NEW_SETUPS_SQL,
            )
        with op.batch_alter_table("saas_subscriptions") as batch_op:
            batch_op.drop_constraint("ck_saas_subscriptions_payment_method", type_="check")
            batch_op.create_check_constraint(
                "ck_saas_subscriptions_payment_method",
                NEW_SUBS_SQL,
            )
        return

    op.drop_constraint("ck_saas_billing_setups_payment_method", "saas_billing_setups", type_="check")
    op.create_check_constraint(
        "ck_saas_billing_setups_payment_method",
        "saas_billing_setups",
        NEW_SETUPS_SQL,
    )
    op.drop_constraint("ck_saas_subscriptions_payment_method", "saas_subscriptions", type_="check")
    op.create_check_constraint(
        "ck_saas_subscriptions_payment_method",
        "saas_subscriptions",
        NEW_SUBS_SQL,
    )


def downgrade() -> None:
    conn = op.get_bind()
    count_setups = conn.execute(
        sa.text("SELECT count(*) FROM saas_billing_setups WHERE payment_method_type = 'account_money'")
    ).scalar() or 0
    count_subs = conn.execute(
        sa.text("SELECT count(*) FROM saas_subscriptions WHERE payment_method_type = 'account_money'")
    ).scalar() or 0

    if count_setups > 0 or count_subs > 0:
        raise RuntimeError(
            f"Downgrade abortado: existem registros com payment_method_type='account_money' "
            f"(saas_billing_setups: {count_setups}, saas_subscriptions: {count_subs}). "
            f"Migre ou remova esses registros antes de reverter a constraint."
        )

    dialect = conn.dialect.name
    if dialect == "sqlite":
        with op.batch_alter_table("saas_billing_setups") as batch_op:
            batch_op.drop_constraint("ck_saas_billing_setups_payment_method", type_="check")
            batch_op.create_check_constraint(
                "ck_saas_billing_setups_payment_method",
                OLD_SETUPS_SQL,
            )
        with op.batch_alter_table("saas_subscriptions") as batch_op:
            batch_op.drop_constraint("ck_saas_subscriptions_payment_method", type_="check")
            batch_op.create_check_constraint(
                "ck_saas_subscriptions_payment_method",
                OLD_SUBS_SQL,
            )
        return

    op.drop_constraint("ck_saas_billing_setups_payment_method", "saas_billing_setups", type_="check")
    op.create_check_constraint(
        "ck_saas_billing_setups_payment_method",
        "saas_billing_setups",
        OLD_SETUPS_SQL,
    )
    op.drop_constraint("ck_saas_subscriptions_payment_method", "saas_subscriptions", type_="check")
    op.create_check_constraint(
        "ck_saas_subscriptions_payment_method",
        "saas_subscriptions",
        OLD_SUBS_SQL,
    )
