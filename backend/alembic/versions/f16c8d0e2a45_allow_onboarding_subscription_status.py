"""allow onboarding SaaS subscription status

Revision ID: f16c8d0e2a45
Revises: e05b7c9d1f34
Create Date: 2026-09-14
"""

from alembic import op
import sqlalchemy as sa


revision = "f16c8d0e2a45"
down_revision = "e05b7c9d1f34"
branch_labels = None
depends_on = None


_NEW_STATUS_CHECK = (
    "status IN ('onboarding', 'trialing', 'active', 'past_due', 'canceled', 'suspended')"
)
_OLD_STATUS_CHECK = (
    "status IN ('trialing', 'active', 'past_due', 'canceled', 'suspended')"
)


def _replace_status_constraint(expression: str) -> None:
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        with op.batch_alter_table("saas_subscriptions", recreate="always") as batch_op:
            batch_op.drop_constraint("ck_saas_subscriptions_status", type_="check")
            batch_op.create_check_constraint("ck_saas_subscriptions_status", expression)
        return

    op.drop_constraint(
        "ck_saas_subscriptions_status",
        "saas_subscriptions",
        type_="check",
    )
    op.create_check_constraint(
        "ck_saas_subscriptions_status",
        "saas_subscriptions",
        expression,
    )


def upgrade() -> None:
    _replace_status_constraint(_NEW_STATUS_CHECK)


def downgrade() -> None:
    # Downgrade só é seguro se nenhuma assinatura ainda estiver aguardando setup.
    onboarding_count = op.get_bind().execute(
        sa.text("SELECT COUNT(*) FROM saas_subscriptions WHERE status = 'onboarding'")
    ).scalar_one()
    if onboarding_count:
        raise RuntimeError(
            "Não é possível remover o status onboarding enquanto existirem assinaturas nessa etapa."
        )
    _replace_status_constraint(_OLD_STATUS_CHECK)
