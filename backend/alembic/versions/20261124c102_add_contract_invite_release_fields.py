"""add payment_method_type and auto_release_on_accept to contract_invites

Revision ID: 20261124c102
Revises: 20261124c101
Create Date: 2026-11-24
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261124c102"
down_revision: Union[str, Sequence[str], None] = "20261124c101"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "contract_invites" not in inspector.get_table_names():
        return
    columns = {col["name"] for col in inspector.get_columns("contract_invites")}
    if "payment_method_type" not in columns:
        op.add_column(
            "contract_invites",
            sa.Column("payment_method_type", sa.String(length=32), nullable=True),
        )
    if "auto_release_on_accept" not in columns:
        op.add_column(
            "contract_invites",
            sa.Column(
                "auto_release_on_accept",
                sa.Boolean(),
                server_default=sa.text("false"),
                nullable=False,
            ),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "contract_invites" not in inspector.get_table_names():
        return
    columns = {col["name"] for col in inspector.get_columns("contract_invites")}
    if "auto_release_on_accept" in columns:
        op.drop_column("contract_invites", "auto_release_on_accept")
    if "payment_method_type" in columns:
        op.drop_column("contract_invites", "payment_method_type")
