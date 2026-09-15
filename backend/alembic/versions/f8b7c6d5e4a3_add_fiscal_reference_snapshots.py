"""add immutable fiscal official reference snapshots

Revision ID: f8b7c6d5e4a3
Revises: e7a4f6c1b2d9
"""

from alembic import op
import sqlalchemy as sa


revision = "f8b7c6d5e4a3"
down_revision = "e7a4f6c1b2d9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "fiscal_official_reference_snapshots",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("source_key", sa.String(length=64), nullable=False),
        sa.Column("source_url", sa.Text(), nullable=False),
        sa.Column("source_version", sa.String(length=160), nullable=True),
        sa.Column("content_sha256", sa.String(length=64), nullable=True),
        sa.Column("identity_sha256", sa.String(length=64), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=True),
        sa.Column("payload_json", sa.JSON(), nullable=True),
        sa.Column("effective_dates_json", sa.JSON(), nullable=True),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "source_key",
            "identity_sha256",
            name="uq_fiscal_official_reference_snapshot_identity",
        ),
    )
    op.create_index(
        "ix_fiscal_official_reference_snapshot_source_observed",
        "fiscal_official_reference_snapshots",
        ["source_key", "observed_at"],
        unique=False,
    )

    op.add_column(
        "fiscal_official_reference_states",
        sa.Column("observed_snapshot_id", sa.String(length=36), nullable=True),
    )
    op.add_column(
        "fiscal_official_reference_states",
        sa.Column("active_snapshot_id", sa.String(length=36), nullable=True),
    )
    op.create_foreign_key(
        "fk_fiscal_official_reference_state_observed_snapshot",
        "fiscal_official_reference_states",
        "fiscal_official_reference_snapshots",
        ["observed_snapshot_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        "fk_fiscal_official_reference_state_active_snapshot",
        "fiscal_official_reference_states",
        "fiscal_official_reference_snapshots",
        ["active_snapshot_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index(
        "ix_fiscal_official_reference_state_observed_snapshot",
        "fiscal_official_reference_states",
        ["observed_snapshot_id"],
        unique=False,
    )
    op.create_index(
        "ix_fiscal_official_reference_state_active_snapshot",
        "fiscal_official_reference_states",
        ["active_snapshot_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_fiscal_official_reference_state_active_snapshot",
        table_name="fiscal_official_reference_states",
    )
    op.drop_index(
        "ix_fiscal_official_reference_state_observed_snapshot",
        table_name="fiscal_official_reference_states",
    )
    op.drop_constraint(
        "fk_fiscal_official_reference_state_active_snapshot",
        "fiscal_official_reference_states",
        type_="foreignkey",
    )
    op.drop_constraint(
        "fk_fiscal_official_reference_state_observed_snapshot",
        "fiscal_official_reference_states",
        type_="foreignkey",
    )
    op.drop_column("fiscal_official_reference_states", "active_snapshot_id")
    op.drop_column("fiscal_official_reference_states", "observed_snapshot_id")

    op.drop_index(
        "ix_fiscal_official_reference_snapshot_source_observed",
        table_name="fiscal_official_reference_snapshots",
    )
    op.drop_table("fiscal_official_reference_snapshots")
