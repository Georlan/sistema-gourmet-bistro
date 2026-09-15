"""add fiscal official reference watch state

Revision ID: e7a4f6c1b2d9
Revises: d6f31a8c2b74
"""

from alembic import op
import sqlalchemy as sa


revision = "e7a4f6c1b2d9"
down_revision = "d6f31a8c2b74"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "fiscal_official_reference_states",
        sa.Column("source_key", sa.String(length=64), nullable=False),
        sa.Column("source_url", sa.Text(), nullable=False),
        sa.Column("source_version", sa.String(length=160), nullable=True),
        sa.Column("content_sha256", sa.String(length=64), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="current"),
        sa.Column("metadata_json", sa.JSON(), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("changed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('current','changed','error')",
            name="ck_fiscal_official_reference_state_status",
        ),
        sa.PrimaryKeyConstraint("source_key"),
    )
    op.create_index(
        "ix_fiscal_official_reference_status_checked",
        "fiscal_official_reference_states",
        ["status", "checked_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_fiscal_official_reference_status_checked",
        table_name="fiscal_official_reference_states",
    )
    op.drop_table("fiscal_official_reference_states")
