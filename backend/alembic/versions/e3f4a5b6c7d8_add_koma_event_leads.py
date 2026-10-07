"""add koma_event_leads table for event and summit lead capture

Revision ID: e3f4a5b6c7d8
Revises: d2e3f4a5b6c7
Create Date: 2026-10-06

"""
from alembic import op
import sqlalchemy as sa

revision = "e3f4a5b6c7d8"
down_revision = "d2e3f4a5b6c7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    op.create_table(
        "koma_event_leads",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("nome", sa.String(length=120), nullable=False),
        sa.Column("whatsapp_raw", sa.String(length=32), nullable=False),
        sa.Column("whatsapp_normalizado", sa.String(length=20), nullable=False),
        sa.Column("empresa_nome", sa.String(length=120), nullable=True),
        sa.Column("segmento", sa.String(length=80), nullable=True),
        sa.Column("event_slug", sa.String(length=64), server_default="ceara-tech-summit-2026", nullable=False),
        sa.Column("source", sa.String(length=32), server_default="qr_impresso", nullable=False),
        sa.Column("consent_whatsapp", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("consent_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("consent_version", sa.String(length=32), server_default="v1_cearatech_2026", nullable=False),
        sa.Column("status", sa.String(length=32), server_default="new", nullable=False),
        sa.Column("ip_hash", sa.String(length=64), nullable=True),
        sa.Column("user_agent", sa.String(length=255), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("event_slug", "whatsapp_normalizado", name="uq_koma_event_leads_event_whatsapp"),
    )

    op.create_index(
        "ix_koma_event_leads_whatsapp",
        "koma_event_leads",
        ["whatsapp_normalizado"],
        unique=False,
    )
    op.create_index(
        "ix_koma_event_leads_event_created",
        "koma_event_leads",
        ["event_slug", "created_at"],
        unique=False,
    )

    if bind.dialect.name != "postgresql":
        return

    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'koma_app') THEN
                GRANT SELECT, INSERT, UPDATE ON TABLE public.koma_event_leads TO koma_app;
                GRANT USAGE, SELECT ON SEQUENCE public.koma_event_leads_id_seq TO koma_app;
            END IF;
        END
        $$;
    """)


def downgrade() -> None:
    op.drop_index("ix_koma_event_leads_event_created", table_name="koma_event_leads")
    op.drop_index("ix_koma_event_leads_whatsapp", table_name="koma_event_leads")
    op.drop_table("koma_event_leads")
