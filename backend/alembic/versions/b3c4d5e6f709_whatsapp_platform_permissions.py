"""Explicit platform-owned WhatsApp permissions, legacy rollout preserved.

Revision ID: b3c4d5e6f709
Revises: a9c4e1b8d203
"""
from alembic import op
import sqlalchemy as sa

revision = "b3c4d5e6f709"
down_revision = "a9c4e1b8d203"
branch_labels = None
depends_on = None


def upgrade():
    # The flag 'managed' is false for every pre-existing tenant. Consequently
    # old environment allowlists keep exactly their previous effective meaning.
    # Neither channel is implicitly enabled for a new restaurant.
    for name in (
        "whatsapp_platform_managed",
        "whatsapp_platform_operator_allowed",
        "whatsapp_platform_customer_allowed",
    ):
        op.add_column(
            "configuracoes_restaurante",
            sa.Column(name, sa.Boolean(), nullable=False, server_default=sa.false()),
        )


def downgrade():
    count = op.get_bind().execute(sa.text(
        "SELECT count(*) FROM configuracoes_restaurante WHERE whatsapp_platform_managed = true"
    )).scalar_one()
    if count:
        raise RuntimeError("Não apagar permissões administrativas persistidas.")
    for name in (
        "whatsapp_platform_customer_allowed",
        "whatsapp_platform_operator_allowed",
        "whatsapp_platform_managed",
    ):
        op.drop_column("configuracoes_restaurante", name)
