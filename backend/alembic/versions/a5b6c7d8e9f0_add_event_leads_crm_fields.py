"""add CRM qualification fields to KOMA event leads

Revision ID: a5b6c7d8e9f0
Revises: f4a5b6c7d8e9
Create Date: 2026-10-07
"""
from alembic import op
import sqlalchemy as sa

revision = "a5b6c7d8e9f0"
down_revision = "f4a5b6c7d8e9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("koma_event_leads", sa.Column("contacted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("koma_event_leads", sa.Column("cidade", sa.String(length=100), nullable=True))
    op.add_column("koma_event_leads", sa.Column("quantidade_unidades", sa.Integer(), nullable=True))
    op.add_column("koma_event_leads", sa.Column("sistema_atual", sa.String(length=120), nullable=True))
    op.add_column("koma_event_leads", sa.Column("principal_dor", sa.Text(), nullable=True))
    op.add_column("koma_event_leads", sa.Column("interesse", sa.String(length=255), nullable=True))
    op.add_column("koma_event_leads", sa.Column("melhor_horario_contato", sa.String(length=120), nullable=True))
    op.create_index(
        "ix_koma_event_leads_event_status_created",
        "koma_event_leads",
        ["event_slug", "status", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_koma_event_leads_event_status_created", table_name="koma_event_leads")
    for column in (
        "melhor_horario_contato",
        "interesse",
        "principal_dor",
        "sistema_atual",
        "quantidade_unidades",
        "cidade",
        "contacted_at",
    ):
        op.drop_column("koma_event_leads", column)
