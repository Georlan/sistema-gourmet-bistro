"""add CRM fields to event leads

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
    op.add_column("koma_event_leads", sa.Column("last_contact_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("koma_event_leads", sa.Column("cidade", sa.String(length=120), nullable=True))
    op.add_column("koma_event_leads", sa.Column("quantidade_unidades", sa.Integer(), nullable=True))
    op.add_column("koma_event_leads", sa.Column("sistema_atual", sa.String(length=120), nullable=True))
    op.add_column("koma_event_leads", sa.Column("principal_dor", sa.Text(), nullable=True))
    op.add_column("koma_event_leads", sa.Column("interesse", sa.Text(), nullable=True))
    op.add_column("koma_event_leads", sa.Column("melhor_horario_contato", sa.String(length=120), nullable=True))
    op.create_check_constraint(
        "ck_koma_event_leads_status",
        "koma_event_leads",
        "status IN ('new', 'contacted', 'qualified', 'demo_scheduled', 'converted', 'lost')",
    )
    op.create_index(
        "ix_koma_event_leads_event_status_created",
        "koma_event_leads",
        ["event_slug", "status", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_koma_event_leads_event_status_created", table_name="koma_event_leads")
    op.drop_constraint("ck_koma_event_leads_status", "koma_event_leads", type_="check")
    op.drop_column("koma_event_leads", "melhor_horario_contato")
    op.drop_column("koma_event_leads", "interesse")
    op.drop_column("koma_event_leads", "principal_dor")
    op.drop_column("koma_event_leads", "sistema_atual")
    op.drop_column("koma_event_leads", "quantidade_unidades")
    op.drop_column("koma_event_leads", "cidade")
    op.drop_column("koma_event_leads", "last_contact_at")
